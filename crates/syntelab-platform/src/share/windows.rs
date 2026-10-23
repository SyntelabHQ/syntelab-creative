use std::cell::RefCell;
use std::path::Path;

use windows::core::{factory, AgileReference, Interface, Ref, HSTRING};
use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
use windows::Foundation::TypedEventHandler;
use windows::Storage::{IStorageItem, StorageFile};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::IDataTransferManagerInterop;
use windows_collections::IIterable;

use super::ShareError;

/// A file ready to be shared.
pub struct Shareable {
    /// Found on a worker thread, used on the window's thread: an agile
    /// reference is what may cross between them.
    file: AgileReference<StorageFile>,
    title: HSTRING,
}

thread_local! {
    /// The answer to the previous share request, to take back before giving a
    /// new one. Kept by the thread that owns the window, the only one to share.
    static LAST_REQUEST: RefCell<Option<(DataTransferManager, i64)>> = const { RefCell::new(None) };
}

fn failed(error: windows::core::Error) -> ShareError {
    ShareError::Failed(error.message())
}

pub(super) fn prepare(path: &Path) -> Result<Shareable, ShareError> {
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))
        .and_then(|operation| operation.join())
        .map_err(failed)?;
    let title = path.file_name().map(HSTRING::from).unwrap_or_default();
    let file = AgileReference::new(&file).map_err(failed)?;
    Ok(Shareable { file, title })
}

impl Shareable {
    /// Opens the share window over the program's window (`window_handle` is
    /// its HWND). Must run on the thread that owns that window.
    pub fn show(self, window_handle: isize) -> Result<(), ShareError> {
        let window = HWND(window_handle as *mut _);
        let interop: IDataTransferManagerInterop =
            factory::<DataTransferManager, IDataTransferManagerInterop>().map_err(failed)?;
        let manager: DataTransferManager = unsafe { interop.GetForWindow(window) }.map_err(failed)?;

        // Windows asks what to share once the window opens; this is the answer.
        let Shareable { file, title } = self;
        let answer = TypedEventHandler::new(
            move |_: Ref<DataTransferManager>, request: Ref<DataRequestedEventArgs>| {
                let Some(request) = request.as_ref() else {
                    return Ok(());
                };
                let data = request.Request()?.Data()?;
                data.Properties()?.SetTitle(&title)?;
                let items: IIterable<IStorageItem> = vec![Some(file.resolve()?.cast::<IStorageItem>()?)].into();
                data.SetStorageItemsReadOnly(&items)
            },
        );

        LAST_REQUEST.with(|last| {
            if let Some((previous, token)) = last.borrow_mut().take() {
                let _ = previous.RemoveDataRequested(token);
            }
            let token = manager.DataRequested(&answer)?;
            *last.borrow_mut() = Some((manager, token));
            Ok(())
        })
        .map_err(failed)?;

        unsafe { interop.ShowShareUIForWindow(window) }.map_err(failed)
    }
}
