# 0014 — Font Awesome Free icons

**Context:** The program needs one consistent icon set for the shell and all apps, usable in an open source (AGPL-3.0) project.

**Decision:** All icons come from **Font Awesome Free** (https://fontawesome.com, icon search: https://fontawesome.com/search?ic=free-collection), used as plain SVG files:
- interface icons (buttons, menus): `assets/icons/<name>.svg`;
- app icons: `apps/<app-id>/assets/icon.svg`;
- program logo: `assets/brand/icon.svg`.

License (https://fontawesome.com/license/free, checked 2026-10-09): icons are **CC BY 4.0**. Commercial use, embedding in desktop apps and modification are allowed. Attribution is required; the comment embedded in each downloaded SVG is sufficient, so it must stay in the files.

**Consequences:**
- Only Free icons. Font Awesome Pro icons are never added to the repository.
- The attribution comment is not removed from the SVG files; Font Awesome Free is listed in `THIRD-PARTY.md` at publication.
- The name "Font Awesome" is not used in the name of the program or its apps.
- Brand icons (logos of other companies) are used only to refer to that company or product.
- The program logo is a Font Awesome Free icon too (`bolt`), shown in white on a rounded square in the brand color `#007BFF`. Icons under CC BY 4.0 are available to everyone, so the logo is not exclusive. Decided 2026-10-09: the logo is **not** registered as a trademark; it is only used legally under its license.
