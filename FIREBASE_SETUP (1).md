# Coba Studios Estimator - Jobs cloud sync (Firebase)

Set up October 2026. Firebase project: **Coba Studios Estimator** (`coba-studios-estimator`), free Spark plan.
Menu names below match the Firebase console as of Oct 2026 - Google renames things, so if a name is missing, use **Search for products** at the top of the left sidebar.

## Adding a new person
1. console.firebase.google.com -> click **Coba Studios Estimator**.
2. Left sidebar: **Security** -> **Authentication** -> **Users** tab (top of page) -> **Add user** -> enter email + password.
3. Left sidebar: **Databases & Storage** -> **Firestore** -> **Rules** tab (top of page).
4. Add their email to the list on the `request.auth.token.email in [...]` line - lowercase, in single quotes, commas between, all inside ONE pair of square brackets.
5. Click **Publish**. Wait about a minute.
6. On their device: open crepracon.github.io/Cobastudios/ -> **Jobs** tab -> **Cloud settings** -> sign in.

## Current rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email in ['info@cobastudios.com', 'cobastudiosprint@gmail.com', 'chrischinkiwsky@gmail.com'];
    }
  }
}
```

## Signing in on a new computer or phone
1. Open crepracon.github.io/Cobastudios/ in a normal browser tab (not a file preview - previews block Firebase).
2. **Jobs** tab -> **Cloud settings** -> email + password -> **Sign in**.
3. The label turns green: **Cloud sync: on**.
4. If that device had jobs saved before, a yellow box appears -> **Merge into cloud**.

## What the status label means
| Label | Meaning | Fix |
|---|---|---|
| Cloud sync: on (green) | Working | - |
| Cloud sync: off / signed out | Not signed in on this device | Cloud settings -> Sign in |
| Cloud sync: offline (yellow) | No internet | Changes sync automatically when back online |
| Cloud sync could not load (red) | Firebase code couldn't download | Use the live site, not a preview; try Incognito (ad blocker) or phone data (shop firewall) |
| permission-denied (red) | Signed in, but email not in the rules | Add the email to the rules and Publish |

## Where things live in Firebase
- Jobs data: **Databases & Storage** -> **Firestore** -> **Data** tab. Two collections: `customers` and `estimates`.
- Logins: **Security** -> **Authentication** -> **Users** tab.
- Allowed websites: **Security** -> **Authentication** -> **Settings** tab -> **Authorized domains** (has `crepracon.github.io`).
- App config: left sidebar **Settings** -> **General** -> scroll to **Your apps**. Already built into index.html.

## Good to know
- App updates (new index.html) never touch the jobs - they live in Firestore.
- Two computers editing different jobs at the same time is fine. Same field on the same job at the same moment: last save wins.
- Still use **Export backup** on the Jobs tab now and then.
