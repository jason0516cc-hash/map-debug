# Zephyrax.pro

A browser-based flower survival/combat game — collect petals, craft gear, fight waves of mobs and bosses across Ocean, Garden, and Desert maps.

## Playing locally

This is a plain static site (HTML + ES module JavaScript, no build step). You just need to serve the folder over HTTP — opening `index.html` directly via `file://` won't work because browsers block ES module imports from the local filesystem.

Any of these work:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

Then open `http://localhost:8000` in your browser.

## Deploying to GitHub Pages

This is a plain static site, so GitHub can serve it directly from your `main` branch — no build step or workflow needed.

1. Push this repo to GitHub, with these files at the root of the `main` branch.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Set **Branch** to `main` and folder to `/ (root)`, then **Save**.
5. After a minute or two, your game will be live at `https://<your-username>.github.io/<repo-name>/`.

Since all asset and script paths in this project are relative, it works correctly regardless of the repo name or subpath it's hosted under.

## Sharing with friends

Once deployed, just send them the GitHub Pages link — it works on any device with a modern browser, no installation needed.

## Project structure

```
index.html       – entry point, page markup and styles
assets/          – game source (rendering, combat, UI, maps, etc.)
zicons/          – UI icons
favicon.png      – site icon
*.woff2          – custom font
```
