# Badge art

Drop a square PNG here named after the badge id and it shows up in the app —
no code change needed:

    public/badges/<badge id>.png     e.g. public/badges/type-fire.png

* **Size:** 512×512 works well (it renders ~18–22px, so keep the silhouette bold).
* **Format:** PNG with a transparent background.
* **Missing file?** The badge falls back to a medal glyph, so a partial set is fine.
* **Ids:** every id is listed in `docs/badge-art-prompts.md`, alongside the
  image prompt used to generate it.

Unearned badges are drawn greyscale and dimmed by the app, so each badge only
needs one artwork.
