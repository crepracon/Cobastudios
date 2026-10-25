# Coba Studios Estimator - Jobs cloud sync setup (one time, ~10 min)

Do this on a computer. Firebase's free "Spark" plan is plenty for the shop.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. **Add project** -> name it `coba-studios` -> Google Analytics can be turned off -> Create.

## 2. Turn on the database
1. Left menu: **Build -> Firestore Database -> Create database**.
2. Location: `northamerica-northeast1 (Montreal)` (closest to Brockville; can't be changed later).
3. Start in **production mode**.

## 3. Turn on sign-in and create the logins
1. **Build -> Authentication -> Get started -> Email/Password** -> enable the first toggle -> Save.
2. **Users tab -> Add user** for each person who should see the jobs (or one shared shop login).
3. **Settings tab -> Authorized domains -> Add domain** -> `crepracon.github.io`

## 4. Lock the database to your logins
**Firestore Database -> Rules tab**, replace everything with this (put in the emails you created), then **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email in ['you@example.com', 'coworker@example.com'];
    }
  }
}
```

The email list matters: without it, anyone who found your project could create their own login and read customer info.

## 5. Get the config
1. Gear icon -> **Project settings** -> scroll to **Your apps** -> click the **</>** (Web) icon.
2. Nickname `estimator` -> Register app (skip Firebase Hosting).
3. Copy the `firebaseConfig = { ... }` block it shows. This is not a password - it's safe in the app.

## 6. Connect the estimator
1. Open the live estimator -> **Jobs** tab -> **Cloud settings**.
2. Paste the config -> **Save config** -> sign in with one of the logins.
3. If that device already has jobs, a yellow banner offers **Merge into cloud** - click it.
4. Repeat step 6 on each computer/phone (or send the config to Claude to build it into the app, so new devices only need to sign in).

## Good to know
- Jobs now live in Firestore, not in index.html - pushing new app versions never touches them.
- Each estimate is its own record, so two computers working at the same time don't overwrite each other. If both edit the *same* field at the same moment, the last save wins.
- Keep using **Export backup** now and then - it downloads the full list.
