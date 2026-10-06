# amirbalazade

Personal site. Astro, static output, served from a Cloudflare Worker's asset directory.

```bash
npm install
npm run dev      # local, http://localhost:4321
npm run build    # static output into dist/
```

Pushing to `main` builds and deploys through `.github/workflows/deploy.yml`. The workflow needs two
repository secrets: `CLOUDFLARE_API_TOKEN` (scoped to Workers Scripts Write on this account) and
`CLOUDFLARE_ACCOUNT_ID`.

## Where the content comes from

`src/data/cv.json` holds the CV. `/cv` renders it as a WordPad window, `/about` reads location,
education and skills from it, and `public/amir-balazade-cv.pdf` is the same CV as a download.

## How windows work

`src/data/apps.ts` lists every app: title, icon, route and window size. Each route renders the
desktop with its own window open, so every page has its content with JavaScript off. On the client,
opening an app fetches its route and lifts the `[data-window]` element out of it. Fetched markup
arrives without its scoped styles or scripts, so window CSS lives in `src/styles/apps.css` and app
behaviour in the delegated handlers of `src/scripts/apps.ts`.

## Demos

The two demos are separate repositories and separate Workers, linked from here:

- OSSA — <https://ossa.abalazade.workers.dev>
- CAIRN — <https://cairn.abalazade.workers.dev>

## XP assets

`public/xp/` holds Windows XP icons, sounds and the Bliss wallpaper, and `src/styles/vendor/xp.css` the
window chrome. They come from:

- Icons, sounds, Start button: [win32.run](https://github.com/ducbao414/win32.run) (MIT code; the art is Microsoft's)
- Boot flag, Start menu avatar: [winXP](https://github.com/ShizukuIchi/winXP)
- Bliss: the 4K copy on the Internet Archive (`windows-xp-4k`), resized to 1280, 1920 and 2560
- Chrome: [XP.css](https://github.com/botoxparty/XP.css) 0.2.6, MIT, with its hosted fonts removed

Windows XP, Bliss and the icons belong to Microsoft. This site is not affiliated with Microsoft.
