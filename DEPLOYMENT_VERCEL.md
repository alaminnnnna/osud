# Deploying Medora to Vercel — the honest assessment

**Summary: a fully self-contained writable SQLite database is NOT feasible on
Vercel under the current runtime constraints. Render
([`DEPLOYMENT_RENDER.md`](DEPLOYMENT_RENDER.md)) is the self-contained
deployment option.** This document explains exactly why, and what *would* work
on Vercel — without silently adding a paid external database.

## Why persistent SQLite does not work on Vercel

1. **Ephemeral filesystem.** Only `/tmp` is writable, and each serverless
   invocation may run on a different instance with a fresh `/tmp`. A SQLite
   file written during request A is gone (or belongs to another instance) for
   request B.
2. **No shared writable disk.** Vercel offers no persistent-disk primitive
   equivalent to Render's. There is no single filesystem the whole deployment
   can treat as its database home.
3. **Forked state.** Even if each instance bundled its own copy of
   `data/medora.sqlite`, ingest writes (admin, `/api/v1/ingest/*`, price
   history) would diverge per instance — silent data corruption by design.
4. **Native driver constraint.** `better-sqlite3` works as a
   `serverExternalPackages` dependency, so the *driver* is fine — the platform
   storage is the blocker, not the code.

## What Vercel *can* do with this repository

- **Read-only catalogue preview (no persistence claims).** The build can bundle
  a database snapshot, and every page/API reads work — but any write is lost
  on the next invocation. Useful for demos; never for production data.
- **Full production parity** requires an external managed database
  (PostgreSQL on Neon/Supabase/Railway, or a managed SQLite-compatible store).
  That is precisely the "separately rented database service" this project
  explicitly avoids, so it is **not configured here**. The legacy PostgreSQL
  implementation remains in `git` history if that trade-off is ever wanted.

## Recommended path

Deploy to **Render** with a persistent disk — one web service, frontend and
backend together, database on the disk, backups on the same disk. See
[`DEPLOYMENT_RENDER.md`](DEPLOYMENT_RENDER.md).
