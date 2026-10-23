//! A small waiting line for render jobs: newest first, bounded.
//!
//! While the user scrolls, requests arrive faster than pages can be drawn.
//! The page asked for last is the one on screen, so it is served first, and
//! when the line is full the oldest request is given up.

use std::collections::VecDeque;

/// A job that can be told it will not be done.
pub trait Job: Send + 'static {
    /// Called instead of running the job, when newer jobs pushed it out or the
    /// document was closed.
    fn reject(self);
}

pub struct JobQueue<J> {
    jobs: VecDeque<J>,
    capacity: usize,
}

impl<J> JobQueue<J> {
    pub fn new(capacity: usize) -> Self {
        Self { jobs: VecDeque::new(), capacity: capacity.max(1) }
    }

    /// Adds a job and returns the ones that no longer fit, oldest first.
    #[must_use = "jobs pushed out of the queue must be rejected"]
    pub fn push(&mut self, job: J) -> Vec<J> {
        self.jobs.push_back(job);
        let overflow = self.jobs.len().saturating_sub(self.capacity);
        self.jobs.drain(..overflow).collect()
    }

    /// Takes the newest job.
    pub fn pop(&mut self) -> Option<J> {
        self.jobs.pop_back()
    }

    /// Empties the queue, returning what was waiting.
    pub fn drain(&mut self) -> Vec<J> {
        self.jobs.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_the_newest_job_first() {
        let mut queue = JobQueue::new(8);
        for job in 1..=3 {
            assert!(queue.push(job).is_empty());
        }
        assert_eq!(queue.pop(), Some(3));
        assert_eq!(queue.pop(), Some(2));
        assert_eq!(queue.pop(), Some(1));
        assert_eq!(queue.pop(), None);
    }

    #[test]
    fn gives_up_the_oldest_jobs_when_full() {
        let mut queue = JobQueue::new(2);
        assert!(queue.push(1).is_empty());
        assert!(queue.push(2).is_empty());
        assert_eq!(queue.push(3), [1]);
        assert_eq!(queue.drain(), [2, 3]);
        assert_eq!(queue.pop(), None);
    }
}
