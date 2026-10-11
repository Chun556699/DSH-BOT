# Agent Note: Permanent Session deletion

Status: implemented

English | [中文](2026-10-11-permanent-session-deletion.zh.md)

## Problem

Archive hides a Session but keeps its history and files. A permanent delete action needs a reliable ownership rule: a Session's working directory can contain shared project files, and an active writer can recreate files during cleanup.

## Decision

Session Controller deletes only persistence-owned storage after the user confirms. It refuses running work through the existing archive-activity providers, excludes API activation, and awaits an API-owned Agent handle's disposal before asking persistence to delete. A cold Session needs no activation. A foreign live owner or writer is refused.

The JSONL provider owns removal of the encoded Session directory and all its generations, with in-process and kernel write exclusion. Nested links are unlinked rather than followed. Every removal resolves through directories deletion has opened: Linux uses `/proc/self/fd` paths, and Windows pins each directory with a handle that denies its rename. A directory replaced during deletion therefore causes a rejection. Hosts without either mechanism report `supportsDeletion: false`. Lock acquisition never truncates the lock file and refuses link-shaped or multiply linked lock paths. On POSIX the lock inode remains until every log is gone. Workspace membership, pins, and archives are removed afterwards; catalog removal and navigation clearing occur only after success.

## Alternatives considered

**Delete the working directory.** Workspace registration and Session metadata do not establish exclusive ownership of project files. Removing that directory can destroy another Session's work.

**Treat archive as deletion.** Archive intentionally retains history and an undo path, so it cannot fulfill permanent removal.

**Check each path, then remove it by path.** Node has no descriptor-relative removal. Another process can replace a checked directory with a link before the next operation, and recursive removal then reaches the link target.

**Remove shared attachment or spill objects.** Fork history can retain their references. Without reference accounting, deleting those objects would break surviving conversations.

## Consequences

Deletion is irreversible and can partially complete. A rejected cleanup does not emit catalog removal, but it does not restore deleted files or a disposed Agent. The confirmation stays open for retry; refreshed lists can omit a Session whose log was already removed. Shared project files, attachment objects, separate spill storage, and other Sessions remain. macOS and the browser worker cannot delete JSONL Sessions.

Storage, Remote, Client catalog, navigation, and browser tests verify ownership refusal, cancellation, retry, and preservation of unrelated files. The [kernel lease](2026-08-31-cross-process-session-write-lease.md) and [archive activity](2026-09-21-archive-stops-running-session-work.md) decisions remain independently applicable.
