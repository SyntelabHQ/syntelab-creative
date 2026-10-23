//! A thread that owns one open PDF and draws from it on request.

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};

use crate::engine::{EngineError, PdfFile};

use super::queue::{Job, JobQueue};

/// What a worker does with its document.
pub trait Work: Send + 'static {
    type Job: Job;

    fn run(&mut self, file: &PdfFile, job: Self::Job);

    /// Does one small piece of background work when no job is waiting.
    /// Returns false when there is nothing left to do.
    fn idle(&mut self, _file: &PdfFile) -> bool {
        false
    }
}

struct State<J> {
    queue: JobQueue<J>,
    closed: bool,
}

struct Shared<J> {
    state: Mutex<State<J>>,
    wake: Condvar,
}

impl<J> Shared<J> {
    fn lock(&self) -> MutexGuard<'_, State<J>> {
        // A panic in another thread must not take the whole document down.
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Handle to a worker thread. Dropping it stops the thread, rejects the jobs
/// still waiting, and returns only when the thread has ended, so the file it
/// had open is free again.
pub struct Worker<J: Job> {
    shared: Arc<Shared<J>>,
    thread: Option<JoinHandle<()>>,
}

impl<J: Job> Worker<J> {
    /// Opens `path` on a new thread. `on_open` runs there once, right after
    /// opening; its result (or the reason opening failed) is returned.
    pub fn spawn<W, T>(
        name: &str,
        path: PathBuf,
        capacity: usize,
        mut work: W,
        on_open: impl FnOnce(&PdfFile) -> Result<T, EngineError> + Send + 'static,
    ) -> Result<(Self, T), EngineError>
    where
        W: Work<Job = J>,
        T: Send + 'static,
    {
        let shared = Arc::new(Shared {
            state: Mutex::new(State { queue: JobQueue::new(capacity), closed: false }),
            wake: Condvar::new(),
        });
        let (opened_sender, opened) = mpsc::sync_channel(1);

        let thread_shared = Arc::clone(&shared);
        let thread = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                let file = match PdfFile::open(&path).and_then(|file| on_open(&file).map(|value| (file, value))) {
                    Ok((file, value)) => {
                        let _ = opened_sender.send(Ok(value));
                        file
                    }
                    Err(error) => {
                        let _ = opened_sender.send(Err(error));
                        return;
                    }
                };
                run_loop(&thread_shared, &file, &mut work);
            })
            .map_err(|error| EngineError::Failed(error.to_string()))?;

        let value = opened
            .recv()
            .map_err(|_| EngineError::Failed("the document thread stopped while opening".into()))??;
        Ok((Self { shared, thread: Some(thread) }, value))
    }

    pub fn submit(&self, job: J) {
        let rejected = {
            let mut state = self.shared.lock();
            if state.closed {
                vec![job]
            } else {
                state.queue.push(job)
            }
        };
        self.shared.wake.notify_one();
        rejected.into_iter().for_each(Job::reject);
    }
}

impl<J: Job> Drop for Worker<J> {
    fn drop(&mut self) {
        let waiting = {
            let mut state = self.shared.lock();
            state.closed = true;
            state.queue.drain()
        };
        self.shared.wake.notify_one();
        waiting.into_iter().for_each(Job::reject);
        // A thread cannot wait for itself; anyone else waits for the file to be let go.
        if let Some(thread) = self.thread.take() {
            if thread.thread().id() != thread::current().id() {
                let _ = thread.join();
            }
        }
    }
}

fn run_loop<W: Work>(shared: &Shared<W::Job>, file: &PdfFile, work: &mut W) {
    let mut has_idle_work = true;
    loop {
        let job = {
            let mut state = shared.lock();
            loop {
                if state.closed {
                    return;
                }
                if let Some(job) = state.queue.pop() {
                    break Some(job);
                }
                if has_idle_work {
                    break None;
                }
                state = shared.wake.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };
        match job {
            Some(job) => work.run(file, job),
            None => has_idle_work = work.idle(file),
        }
    }
}
