use super::{
    activate, available, dismiss, foreground, now_ms, reveal_label, Notice, NotificationActions,
    REVEAL_ACTION,
};
use block2::{DynBlock, RcBlock};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{Bool, ProtocolObject},
    AnyThread, DefinedClass, MainThreadMarker,
};
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSSet, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNNotificationDefaultActionIdentifier, UNNotificationDismissActionIdentifier,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use std::cell::RefCell;
use tauri::Manager;

const CATEGORY: &str = "visuales-download-completed";

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "VisualesNotificationDelegate"]
    #[thread_kind = AnyThread]
    #[ivars = tauri::AppHandle]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let app = self.ivars();
            let id = notification.request().identifier().to_string();
            let allowed = available(app)
                && app.state::<NotificationActions>().permits_presentation(
                    &id,
                    foreground(app),
                    now_ms(),
                );
            if !allowed {
                dismiss(app, &id);
            }
            completion.call((if allowed {
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List
            } else {
                UNNotificationPresentationOptions::empty()
            },));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_respond(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            let id = response.notification().request().identifier().to_string();
            let action = response.actionIdentifier();
            // Framework constants are immutable and valid for the process lifetime.
            if &*action == unsafe { UNNotificationDismissActionIdentifier } {
                dismiss(self.ivars(), &id);
            } else if &*action == unsafe { UNNotificationDefaultActionIdentifier } {
                activate(self.ivars(), &id, "default");
            } else {
                activate(self.ivars(), &id, &action.to_string());
            }
            completion.call(());
        }
    }
);

thread_local! {
    // Apple's delegate property is weak; retain it on Tauri's main thread for the app lifetime.
    static DELEGATE: RefCell<Option<Retained<NotificationDelegate>>> = const { RefCell::new(None) };
}

pub fn is_bundled() -> bool {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
}

pub fn setup(app: &tauri::AppHandle) -> Result<(), String> {
    if !is_bundled() {
        return Ok(());
    }
    MainThreadMarker::new().ok_or("Notification setup must run on the main thread")?;
    DELEGATE.with(|slot| {
        if slot.borrow().is_some() {
            return;
        }
        let delegate = NotificationDelegate::alloc().set_ivars(app.clone());
        // NSObject's designated initializer, with initialized Rust ivars retained by objc2.
        let delegate: Retained<NotificationDelegate> = unsafe { msg_send![super(delegate), init] };
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        center.setNotificationCategories(&NSSet::from_retained_slice(&[completion_category()]));
        *slot.borrow_mut() = Some(delegate);
    });
    Ok(())
}

fn completion_category() -> Retained<UNNotificationCategory> {
    let action = UNNotificationAction::actionWithIdentifier_title_options(
        &NSString::from_str(REVEAL_ACTION),
        &NSString::from_str(reveal_label()),
        UNNotificationActionOptions::AuthenticationRequired,
    );
    UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(CATEGORY),
        &NSArray::from_retained_slice(&[action]),
        &NSArray::new(),
        UNNotificationCategoryOptions::CustomDismissAction,
    )
}

fn content_for(notice: &Notice, name: &str) -> Retained<UNMutableNotificationContent> {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(notice.title()));
    content.setBody(&NSString::from_str(name));
    if notice.can_reveal() {
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));
    }
    content
}

fn submit(app: tauri::AppHandle, notice: Notice, name: String, id: String) {
    if !available(&app)
        || !app
            .state::<NotificationActions>()
            .permits_presentation(&id, foreground(&app), now_ms())
    {
        dismiss(&app, &id);
        return;
    }
    // Only an opaque session token reaches Notification Center, never a local path or URL.
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(&id),
        &content_for(&notice, &name),
        None,
    );
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(
            &request,
            Some(&RcBlock::new(move |error: *mut NSError| {
                if !error.is_null() {
                    dismiss(&app, &id);
                    eprintln!(
                        "Operating system rejected download notification {}",
                        notice.task_id
                    );
                } else {
                    eprintln!("Native macOS notification accepted for {}", notice.task_id);
                }
            })),
        );
}

pub fn show(app: &tauri::AppHandle, notice: &Notice, name: &str, id: &str) -> Result<(), String> {
    let target = app.clone();
    let notice = notice.clone();
    let name = name.to_owned();
    let id = id.to_owned();
    app.run_on_main_thread(move || {
        if !available(&target) {
            dismiss(&target, &id);
            return;
        }
        // The OS remembers authorization. Never fall back to another identity when permission is denied.
        let permission_app = target.clone();
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert,
                &RcBlock::new(move |granted: Bool, error: *mut NSError| {
                    if !granted.as_bool() || !error.is_null() {
                        dismiss(&permission_app, &id);
                        eprintln!("Download notification permission denied or unavailable");
                        return;
                    }
                    let app = permission_app.clone();
                    let notice = notice.clone();
                    let name = name.clone();
                    let id = id.clone();
                    let failure_id = id.clone();
                    if permission_app
                        .run_on_main_thread(move || submit(app, notice, name, id))
                        .is_err()
                    {
                        dismiss(&permission_app, &failure_id);
                    }
                }),
            );
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_category_has_one_authenticated_finder_action() {
        // Notification Center may invoke its delegate off the main thread.
        fn assert_thread_safe<T: Send + Sync>() {}
        assert_thread_safe::<NotificationDelegate>();
        let category = completion_category();
        assert_eq!(category.identifier().to_string(), CATEGORY);
        let actions = category.actions();
        assert_eq!(actions.len(), 1);
        let action = actions.objectAtIndex(0);
        assert_eq!(action.identifier().to_string(), REVEAL_ACTION);
        assert_eq!(action.title().to_string(), "Show in Finder");
        assert!(action
            .options()
            .contains(UNNotificationActionOptions::AuthenticationRequired));
        assert!(!action
            .options()
            .contains(UNNotificationActionOptions::Foreground));
    }

    #[test]
    fn native_content_only_offers_reveal_for_completed_destinations_and_never_embeds_paths() {
        let mut notice = super::super::tests::completion("a", "Private output folder");
        let content = content_for(&notice, "A download");
        assert_eq!(content.categoryIdentifier().to_string(), CATEGORY);
        assert_eq!(content.body().to_string(), "A download");
        assert_eq!(content.title().to_string(), "Download completed");
        assert!(content.userInfo().is_empty());
        notice.status = super::super::Status::Failed;
        assert!(content_for(&notice, "A download")
            .categoryIdentifier()
            .is_empty());
    }
}
