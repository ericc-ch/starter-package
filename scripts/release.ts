#!/usr/bin/env bun

import { Command as CliCommand, Options } from "@effect/cli"
import { Command } from "@effect/platform"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Option, pipe } from "effect"

const dryRun = pipe(
  Options.boolean("dry-run"),
  Options.withAlias("d"),
  Options.withDefault(false),
  Options.withDescription("Print release notes without creating release"),
)

const release = CliCommand.make(
  "release",
  { dryRun },
  Effect.fn(function* ({ dryRun }) {
    // 1. Get current tag
    const currentTag = yield* Command.make(
      "git",
      "describe",
      "--tags",
      "--exact-match",
      "HEAD",
    ).pipe(
      Command.string,
      Effect.map((output) => output.trim()),
      Effect.catchAll(() => Effect.succeed("")),
    )

    if (currentTag === "") {
      return yield* Effect.dieMessage("No tag found on HEAD")
    }

    yield* Effect.logInfo(`Current tag: ${currentTag}`)

    // 2. Get previous tag
    const prevTag = yield* Command.make(
      "git",
      "describe",
      "--tags",
      "--abbrev=0",
      `${currentTag}^`,
    ).pipe(
      Command.string,
      Effect.map((s) => {
        const trimmed = s.trim()
        return trimmed === "" ? Option.none() : Option.some(trimmed)
      }),
      Effect.catchAll(() => Effect.succeed(Option.none())),
    )

    yield* Effect.logInfo(
      `Previous tag: ${Option.getOrElse(prevTag, () => "none")}`,
    )

    // 3. Get commits
    const range = Option.match(prevTag, {
      onNone: () => currentTag,
      onSome: (prev) => `${prev}..${currentTag}`,
    })

    const notes = yield* Command.make(
      "git",
      "log",
      range,
      "--pretty=format:- %s (@%an)",
      "--no-merges",
    ).pipe(
      Command.string,
      Effect.map((s) => s.trim() || "Initial release"),
      Effect.catchAll((err) =>
        Effect.dieMessage(`Failed to get git log: ${JSON.stringify(err)}`),
      ),
    )

    yield* Effect.logInfo(`Found ${notes.split("\n").length} commits`)

    // 4. Output or Release
    if (dryRun) {
      yield* Console.log(`\n=== DRY RUN ===`)
      yield* Console.log(`Tag: ${currentTag}`)
      yield* Console.log(
        `Previous tag: ${Option.getOrElse(prevTag, () => "none")}`,
      )
      yield* Console.log(`\nRelease notes:\n${notes}`)
    } else {
      yield* Command.make(
        "gh",
        "release",
        "create",
        currentTag,
        "--title",
        currentTag,
        "--notes",
        notes,
      ).pipe(
        Command.string,
        Effect.catchAll((err) =>
          Effect.dieMessage(`Failed to create release: ${JSON.stringify(err)}`),
        ),
      )
      yield* Effect.logInfo(`Release created: ${currentTag}`)
    }
  }),
)

const cli = CliCommand.run(release, {
  name: "Release Script",
  version: "0.0.0",
})

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
