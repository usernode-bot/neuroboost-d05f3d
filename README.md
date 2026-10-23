# NeuroBoost

A short brain workout every day: three quick exercises, one score each, and
a view of how your score moves over time.

- **Séance du jour** runs the same three exercises for everyone that day, in
  the same order: **Réaction rapide**, **Mémoire des cases** and
  **Anagrammes**. Their content (delays, patterns, words) changes each day.
- Each exercise scores out of 100. The brain-shaped ring fills by a third
  per exercise and shows the day's average once all three are done.
- **Résultats récents** keeps the last 10 scores; **Votre progression** shows
  the average of the last seven workout days.

Scores are stored per person on the app's server, so they survive a reload
or a new phone. The app makes no health or medical claims and asks for no
personal details.

## Running it locally

```sh
npm ci --include=dev
npm run build        # compiles public/tailwind.css
node server.js       # needs DATABASE_URL
```

On Homeroom, the platform injects the database, the identity token and the
environment. The staging preview opens the populated demo at `/?demo=1`.
