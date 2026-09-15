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

`src/data/cv-base.json` holds the facts — names, dates, contact — stated once. `src/data/cv-core.json`
holds the writing for the general audience. `/cv` renders from both, and `public/amir-balazade-cv.pdf`
is the same CV as a download. Change a date in `cv-base.json` and both the page and the next PDF
render agree.

## Demos

The two demos are separate repositories and separate Workers, linked from here:

- OSSA — <https://ossa.abalazade.workers.dev>
- CAIRN — <https://cairn.abalazade.workers.dev>
