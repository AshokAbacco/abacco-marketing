# Send-engine test (no real database or SMTP needed)

Runs the campaign engine against an in-memory Prisma mock and a fake SMTP
transport. From the `server/` folder:

```bash
DATABASE_URL=postgresql://u:p@localhost:5432/db JWT_SECRET=x \
  node --import ../tests/register.mjs ../tests/run-test.mjs
```

`run-test.mjs` uses absolute paths from the build environment; change the
`S` constant (and the jsonwebtoken import path) to your `server/src` and
`server/node_modules` locations before running.
