import type { Command } from "commander";

import { TypefullyConfigError } from "../api/errors.js";
import type { QueueRule } from "../api/types.js";
import { color } from "../output/color.js";
import { formatDateTime, printJson, truncate, writeOut } from "../output/format.js";
import { ctxOf, emitAction } from "./helpers.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function registerQueueCommands(program: Command): void {
  const queue = program.command("queue").description("Inspect the publishing queue and its slot schedule");

  queue
    .command("show")
    .alias("view")
    .description("Show queue slots and the drafts filling them for a date range (default: next 7 days)")
    .option("--from <date>", "start date YYYY-MM-DD")
    .option("--to <date>", "end date YYYY-MM-DD")
    .option("--days <n>", "number of days from --from (default 7)")
    .option("--empty", "only show empty slots")
    .action(async (opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const from = opts.from ?? isoDate(new Date());
      const days = opts.days ? Number(opts.days) : 7;
      const to = opts.to ?? isoDate(new Date(Date.parse(from) + days * 86_400_000));
      const view = await ctx.client.getQueue(set, from, to);
      if (ctx.format === "json") {
        printJson(opts.empty ? { ...view, days: view.days.map((d) => ({ ...d, items: d.items.filter((i) => !i.draft) })) } : view);
        return;
      }
      for (const day of view.days) {
        const items = opts.empty ? day.items.filter((i) => !i.draft) : day.items;
        if (!items.length) continue;
        writeOut(color.bold(day.date));
        for (const item of items) {
          const when = formatDateTime(item.at).slice(11);
          if (item.draft) {
            writeOut(`  ${when}  ${color.green("●")} ${String(item.draft.id).padEnd(9)} ${truncate(item.draft.draft_title || item.draft.preview, 70)}`);
          } else {
            writeOut(`  ${when}  ${color.dim("○ empty slot")}`);
          }
        }
      }
    });

  queue
    .command("schedule")
    .description("Show the queue's slot rules (times + weekdays)")
    .action(async (_opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const schedule = await ctx.client.getQueueSchedule(ctx.requireSocialSet());
      if (ctx.format === "json") {
        printJson(schedule);
        return;
      }
      writeOut(`${color.bold("timezone")}  ${schedule.timezone}`);
      for (const rule of schedule.rules) {
        writeOut(`  ${String(rule.h).padStart(2, "0")}:${String(rule.m).padStart(2, "0")}  ${rule.days.join(",")}`);
      }
    });

  queue
    .command("set-schedule")
    .description("Replace the queue's slot rules")
    .option("--rules <json>", 'JSON array, e.g. [{"h":9,"m":30,"days":["mon","wed","fri"]}]')
    .option("--slot <spec>", "HH:MM[@days] where days is a comma list (default every day); repeatable", (v: string, acc: string[]) => acc.concat(v), [])
    .action(async (opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      let rules: QueueRule[];
      if (opts.rules) {
        try {
          rules = JSON.parse(opts.rules) as QueueRule[];
        } catch {
          throw new TypefullyConfigError("--rules must be valid JSON.");
        }
        if (!Array.isArray(rules)) throw new TypefullyConfigError("--rules must be a JSON array.");
      } else if ((opts.slot as string[]).length) {
        rules = (opts.slot as string[]).map(parseSlot);
      } else {
        throw new TypefullyConfigError("Pass --rules <json> or one or more --slot HH:MM[@mon,wed].");
      }
      const schedule = await ctx.client.setQueueSchedule(set, rules);
      emitAction(ctx, schedule, `updated queue schedule (${schedule.rules.length} rule(s), ${schedule.timezone})`);
    });
}

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function parseSlot(spec: string): QueueRule {
  const [time, daysRaw] = spec.split("@");
  const m = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  if (!m) throw new TypefullyConfigError(`Invalid --slot "${spec}": expected HH:MM[@mon,tue].`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new TypefullyConfigError(`Invalid --slot "${spec}": hour/minute out of range.`);
  const days = daysRaw
    ? daysRaw
        .split(",")
        .map((d) => d.trim().toLowerCase().slice(0, 3))
        .filter(Boolean)
    : ALL_DAYS;
  for (const d of days) {
    if (!ALL_DAYS.includes(d)) throw new TypefullyConfigError(`Invalid day "${d}" in --slot "${spec}".`);
  }
  return { h, m: min, days };
}
