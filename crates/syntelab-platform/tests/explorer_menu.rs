//! Adding entries to Explorer's menu and taking them out again, in a place of
//! the tests' own: the real menu of whoever runs the tests is never touched.
#![cfg(windows)]

use std::path::Path;

use syntelab_platform::explorer_menu::{all_registered, is_registered, register, registered_program, unregister, MenuEntry, MenuGroup, MenuPlace};

/// Runs `reg` on the place of the tests.
fn reg(arguments: &[&str]) -> bool {
    std::process::Command::new("reg").args(arguments).output().is_ok_and(|output| output.status.success())
}

#[test]
fn adds_entries_and_takes_them_out_again() {
    let root = format!(r"Software\SyntelabCreativeTests\{}", std::process::id());
    let place = MenuPlace::under(&format!(r"{root}\Classes"));
    let at = |path: &str| format!(r"HKCU\{root}\Classes\{path}");
    let dev = MenuGroup { id: "dev".into(), label: "Syntelab Dev".into(), icon: Some(r"C:\Programs\icons\apps\dev.ico".into()) };
    let entries = [
        MenuEntry {
            id: "pdf-organizer.convert-to-pdf".into(),
            label: "Convert to PDF with PDF Organizer".into(),
            arguments: vec!["--app".into(), "pdf-organizer".into(), "--action".into(), "convert-to-pdf".into()],
            file_types: vec![".png".into(), ".txt".into()],
            icon: Some(r"C:\Programs\icons\apps\pdf-organizer.ico".into()),
            group: None,
        },
        MenuEntry { id: "dev.checksum".into(), label: "Checksums".into(), arguments: Vec::new(), file_types: vec!["*".into(), "folder".into()], icon: None, group: Some(dev.clone()) },
        MenuEntry { id: "dev.hex".into(), label: "Hex view".into(), arguments: Vec::new(), file_types: vec!["*".into()], icon: None, group: Some(dev) },
    ];
    assert!(!is_registered(&place));

    // What 1.0 wrote (everything under one entry) and what came before it (each entry by itself, on a kind of
    // file the entries no longer show on) is taken out when the entries are written.
    assert!(reg(&["add", &at(r"*\shell\SyntelabCreative\shell\dev.checksum\command"), "/ve", "/d", "old", "/f"]));
    assert!(reg(&["add", &at(r"SystemFileAssociations\.gif\shell\SyntelabCreative.pdf-organizer.combine-to-pdf\command"), "/ve", "/d", "old", "/f"]));
    // Entries of other programs stay.
    assert!(reg(&["add", &at(r"*\shell\Other\command"), "/ve", "/d", "other", "/f"]));
    assert!(is_registered(&place));
    assert!(!all_registered(&place, &entries));
    assert_eq!(registered_program(&place, &entries), None);

    let program = Path::new(r"C:\Programs\syntelab-creative.exe");
    register(&place, program, &entries).expect("registers");
    assert!(all_registered(&place, &entries));
    assert_eq!(registered_program(&place, &entries).as_deref(), Some(program));
    assert!(!reg(&["query", &at(r"*\shell\SyntelabCreative")]));
    assert!(!reg(&["query", &at(r"SystemFileAssociations\.gif\shell\SyntelabCreative.pdf-organizer.combine-to-pdf")]));
    assert!(reg(&["query", &at(r"*\shell\Other")]));
    // The group on every file, the entry by itself on its own kinds, with the group's entries too.
    assert!(reg(&["query", &at(r"*\shell\SyntelabCreative.dev\shell\dev.hex\command")]));
    assert!(reg(&["query", &at(r"Directory\shell\SyntelabCreative.dev\shell\dev.checksum\command")]));
    assert!(reg(&["query", &at(r"SystemFileAssociations\.txt\shell\SyntelabCreative.pdf-organizer.convert-to-pdf"), "/v", "Icon"]));
    assert!(reg(&["query", &at(r"SystemFileAssociations\.txt\shell\SyntelabCreative.dev\shell\dev.checksum")]));

    // Twice is the same as once; another program is pointed at.
    let moved = Path::new(r"D:\Elsewhere\syntelab-creative.exe");
    register(&place, moved, &entries).expect("registers again");
    assert_eq!(registered_program(&place, &entries).as_deref(), Some(moved));

    unregister(&place).expect("unregisters");
    assert!(!is_registered(&place));
    assert!(!all_registered(&place, &entries));
    assert!(reg(&["query", &at(r"*\shell\Other")]));
    // Taking out what is not there is no failure.
    unregister(&place).expect("unregisters again");

    // The place of the tests itself is cleared away.
    let _ = reg(&["delete", r"HKCU\Software\SyntelabCreativeTests", "/f"]);
}
