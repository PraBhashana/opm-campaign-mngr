# OPM JPN Campaign Room

A private web dashboard for running the Instagram page campaign:

- **You (owner)** see all pages, plan each post and story (image, caption, hashtags, link, sticker text), send them for approval, and track results, spend and ROAS.
- **Each page admin** signs in with their own code and sees **only their page**. They approve, ask for changes or reject, mark items as posted, and add Instagram Insights numbers. They never see other pages, your fees, or anyone's access code.

Every page gets 13 weeks of slots automatically: a story on Tuesday, a post on Thursday and a story on Saturday.

No packages and no build step are needed. It's plain HTML/JS plus one serverless function, with data stored in Upstash Redis (free tier).

---

## Deploy to Vercel (about 10 minutes)

### 1. Put the code on GitHub
1. Create a new **private** repository on github.com (for example `opm-campaign-room`).
2. Click **Add file → Upload files** and drag in everything from this folder (`api`, `lib`, `public`, `package.json`, `vercel.json`, `README.md`, `dev-server.js`, `.gitignore`). Commit.

### 2. Import it into Vercel
1. On vercel.com: **Add New… → Project**, then pick the repository.
2. Leave **Framework Preset** as **Other**. Don't set a build command.
3. Click **Deploy**. The first deploy works, but sign-in will say a database is missing. That's expected.

### 3. Add the database
1. In the project, open **Storage** and choose **Upstash → Redis** (Marketplace). Create it on the free plan and connect it to this project.
2. Vercel adds the connection keys for you (`KV_REST_API_URL` and `KV_REST_API_TOKEN`).

### 4. Set your owner password
1. **Settings → Environment Variables**, then add:
   - `OWNER_PASSWORD`: a long password only you know (this is your login).
   - `OWNER_NAME` (optional): how your name shows in conversations. The default is "OPM JPN".
2. **Deployments → ⋯ → Redeploy** so the new settings take effect.

### 5. Start using it
1. Open your Vercel URL and sign in with `OWNER_PASSWORD`.
2. Click **Add a page** for each of the 6 Instagram pages.
3. On each page's **Page settings** tab, click **Copy invite message** and send it to that page's admin on WhatsApp. The link fills in their code for them.

---

## Everyday use

| Who | What they do |
|---|---|
| You | Open a frame, upload the image, write the caption, link and sticker text, then click **Send for approval** |
| Admin | Sees **Review this**, then chooses **Approve**, **Ask for changes** (with a note) or **Reject** |
| You | Changes requested? Edit and send again. Editing something already approved sends it back for approval automatically. |
| Admin | After posting: **Mark as posted** with the live link, then add Insights numbers about 48 hours later |
| You | Add orders, revenue and cost (the agreed fee is used if you leave cost blank). ROAS is calculated for you. |

Red china-marker marks on the film strips show the admin's decisions: a circle means approved, a wavy line means changes requested, and a cross means rejected.

## Access and security
- A page admin's code opens **one page only**. This is checked on the server for every request, not just hidden in the screen.
- **Make a new code** (Page settings) signs out anyone using the old code immediately.
- Changing `OWNER_PASSWORD` signs everyone out.
- Wrong codes are rate-limited (15 tries per 15 minutes per network).
- Images are only served to people signed in to that page.

## Notes
- Images are resized in the browser (to 1080 px wide) before upload. For videos or carousels, paste a Google Drive or Dropbox link in **Video or extra files link**.
- Upstash's free plan (250 MB, 500K commands a month) is plenty for 6 pages × 39 items with images.
- Changing a page's start date moves all dates that haven't been changed by hand and aren't already posted.

## Try it on your computer first (optional)
Requires Node 20+:
```
OWNER_PASSWORD=test123 node dev-server.js
```
Open http://localhost:3000. Data is saved in `.data/db.json` on your computer.
