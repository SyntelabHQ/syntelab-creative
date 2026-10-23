//! Registering the program as an app that opens PDF files, and taking it out
//! again, in a place of the tests' own: the real registry of whoever runs the
//! tests is never touched, and the user's choice is only read.
#![cfg(windows)]

use std::path::Path;

use syntelab_platform::default_app::{register, registered_program, unregister, AppPlace};

/// Runs `reg` on the place of the tests.
fn reg(arguments: &[&str]) -> bool {
    std::process::Command::new("reg").args(arguments).output().is_ok_and(|output| output.status.success())
}

#[test]
fn registers_and_takes_it_out_again() {
    let root = format!(r"Software\SyntelabCreativeDefaultAppTests\{}", std::process::id());
    let place = AppPlace::under(&root);
    let at = |path: &str| format!(r"HKCU\{root}\{path}");
    assert_eq!(registered_program(&place), None);
    // Another program offered in "Open with" stays.
    assert!(reg(&["add", &at(r"Classes\.pdf\OpenWithProgids"), "/v", "Other.pdf", "/d", "", "/f"]));

    let program = Path::new(r"C:\Programs\syntelab-creative.exe");
    register(&place, program).expect("registers");
    assert_eq!(registered_program(&place).as_deref(), Some(program));
    assert!(reg(&["query", &at(r"Classes\SyntelabCreative.pdf\shell\open\command")]));
    assert!(reg(&["query", &at(r"Classes\SyntelabCreative.pdf\DefaultIcon")]));
    assert!(reg(&["query", &at(r"Classes\.pdf\OpenWithProgids"), "/v", "SyntelabCreative.pdf"]));
    assert!(reg(&["query", &at(r"SyntelabCreative\Capabilities\FileAssociations"), "/v", ".pdf"]));
    assert!(reg(&["query", &at("RegisteredApplications"), "/v", "SyntelabCreative"]));

    // Again, from where the program was moved to.
    let moved = Path::new(r"D:\Elsewhere\syntelab-creative.exe");
    register(&place, moved).expect("registers again");
    assert_eq!(registered_program(&place).as_deref(), Some(moved));

    unregister(&place).expect("unregisters");
    assert_eq!(registered_program(&place), None);
    assert!(!reg(&["query", &at(r"Classes\SyntelabCreative.pdf")]));
    assert!(!reg(&["query", &at(r"SyntelabCreative")]));
    assert!(!reg(&["query", &at(r"Classes\.pdf\OpenWithProgids"), "/v", "SyntelabCreative.pdf"]));
    assert!(reg(&["query", &at(r"Classes\.pdf\OpenWithProgids"), "/v", "Other.pdf"]));
    // Taking out what is not there is no failure.
    unregister(&place).expect("unregisters again");

    let _ = reg(&["delete", r"HKCU\Software\SyntelabCreativeDefaultAppTests", "/f"]);
}
