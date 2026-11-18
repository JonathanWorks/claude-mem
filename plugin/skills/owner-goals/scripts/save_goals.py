"""Save an owner-goals snapshot: what the owner asked for in their own prompts, sorted into focus areas, asks and rules.

Input is the goals JSON the map step writes:
  {
    "generated_at": "2026-10-18T23:40:00-07:00",
    "window_days": 31,
    "source_prompt_count": 823,
    "human_summary": "What the owner is trying to do this month, in a few sentences.",
    "focus_areas": [{"rank": 1, "title": "<area name>", "goal": "<one sentence: what the area is for>",
                     "matches": "<saved focus area id>" or null, "latest_at": "2026-10-18 22:11", "times_asked": 4,
                     "evidence": [{"at": "2026-10-18 22:11", "quote": "the owner's exact words"}]}],
    "asks":  [{"rank": 1, "title": "...", "focus_area": "<a focus_areas title>" or null, "latest_at": "...", "times_asked": 2, "evidence": [...]}],
    "rules": [{"when": "<situation, or empty for always>", "then": "<what to do>", "latest_at": "...", "times_asked": 3, "evidence": [...]}]
  }

Every evidence quote is checked against owner-prompts.md: it has to appear in a prompt headed with that
minute. Quotes may skip words with "..." between the pieces. Unverified quotes stop the save and are listed.
A quote dated before the first prompt in owner-prompts.md has aged out of the window (an updated snapshot
carries older quotes forward): it is dropped, and so is an item left with no quote. With no prompts in the file,
every quote has aged out. When every item ages out, the snapshot is saved empty, which clears the old goals.

The save is ONE call to the local worker (POST /api/work-view/owner-goals/save). This script sends the goals it parsed, with the quotes
it checked; the worker builds every row itself, so nothing is sized or checked against a stand-in, validates each part with the schema of
its own write route, and writes all of it or none of it, in one SQLite transaction with story.json written last, inside it. Where each
kind goes:
  focus areas  "owner-goals" rows (task "Focus area: <title>", goal_kind focus-area), and, for an area that
               matches no saved one, a suggested area in My Focus (system suggestions under new ids; "matches" is the model's
               judgment, never a name match)
  asks         "owner-goals" rows (task "Ask: <title>", goal_kind ask), with focus_area and focus_area_id
  rules        suggestions in My Rules: the build story's preferences in the worker's ledger folder (story.json there), source
               owner-goals, replacing the ones an earlier save wrote. The worker writes the file; its folder is the worker's, never worked out
               here. --ledger-dir only asserts a folder, and the worker refuses a different one.
This script keeps only the checks of the goals JSON's own shape and of the quotes, which need the prompts file. Every other check is the
worker's, and a save has exactly two outcomes:
  applied      exit 0: everything was saved.
  not applied  exit 1: every problem is listed and NOTHING was written; fix the cause and run it again.
and one that is not known: a request the worker never answered (a timeout, a lost connection) may or may not have been applied (exit 3). The
save is idempotent by its content, so running the same command again is safe: a save the worker already applied is recognized (the
worker remembers its last saves, so even after a newer save) and changes nothing, in a real run and in a dry run; the key does not depend
on how --map is spelled. generated_at is recorded data and decides nothing: a different save is a new save and is applied. Exit 3 is also an
answer where the rows were rolled back but the rules file could not be put back as it was: it holds the new rules, whole, and the rerun
replaces the same rules. Do not ask the model for a new answer first, as a new answer would suggest its new focus areas a second time.
The "owner-goals" list is written under the home folder's project key so there is one list per computer:
  list state:  human_summary, generated_at, window_days, source_prompt_count, map_path, status, save_key
  one task per item: status todo, goal_kind, rank, title, goal or focus_area, focus_area_id, latest_at,
                     times_asked, evidence ("YYYY-MM-DD HH:MM | quote" per line)
Items from the previous snapshot that are not in this one are marked dropped, so a re-run replaces it.

With --start and --end (the period the prompts cover), the list state also records period_start and period_end.
A period that ended before today is a past month: it is saved to "owner-goals/<start>" as history (the list and
its items are saved done, so they never count as open), and My Work lists it under the Goals month switcher.
A past month suggests no focus areas and no rules: those describe the owner now.

--print-focus-areas prints the saved focus areas (id, name, goal, status) for the map step to match against.

--dry-run sends the same request with dryRun set: the worker plans and checks the save, writes nothing and answers what it would write.
With no worker running, it prints the request and says the worker's check was skipped.

Usage: python3 save_goals.py --goals owner-goals.json --prompts owner-prompts.md [--map owner-map.md]
                             [--start YYYY-MM-DD --end YYYY-MM-DD] [--carried-before "YYYY-MM-DD HH:MM"]
                             [--ledger-dir <dir>] [--dry-run]
       python3 save_goals.py --print-focus-areas
"""
import argparse, datetime, http.client, json, math, os, re, sys, traceback, urllib.error, urllib.request

SAVE_PATH = "/api/work-view/owner-goals/save"
# Exit code for a save the worker never answered: it may or may not have been applied. The refresh never re-asks the model then, since a
# second answer would suggest its new areas again; the same command can be run again, as the worker recognizes a save it already applied.
# Every refusal exits 1: nothing was written, and the cause can be fixed and the command run again.
MAY_HAVE_APPLIED_EXIT = 3
# Exit 3 is also the worker's own answer when it rolled the rows back but could not put the rules file back as it was ("ambiguous").
KIND_LABELS = {"focus-area": "Focus area", "ask": "Ask"}
ITEM_KEYS = ("focus_areas", "asks", "rules")
DEFAULT_TIMEOUT_SECONDS = 30.0
# A wait of an hour is already far past any save; a larger value is a typo, and urllib raises OverflowError on an enormous one.
MAX_TIMEOUT_SECONDS = 3600.0


def expand_home(path):
    """The harness client's expandHome (src/shared/expand-home.ts): a leading ~ or ~/ is the home folder, joined the way node's
    path.join does (so '~//x' is <home>/x); ~user is left alone."""
    home = os.path.expanduser("~")
    if path == "~":
        return home
    if path.startswith("~/") or (os.name == "nt" and path.startswith("~\\")):
        return os.path.normpath(os.path.join(home, path[2:].lstrip("/\\" if os.name == "nt" else "/")))
    return path


def settings_target(document):
    """Where claude-mem's keys live (settings-document.ts settingsTarget): the env block when it holds CLAUDE_MEM_* keys, else the root."""
    env = document.get("env")
    if isinstance(env, dict) and any(key.startswith("CLAUDE_MEM_") for key in env):
        return env
    return document


def read_settings(path):
    """The claude-mem settings in a settings.json (flat or wrapped in env), or {} when it is missing or unreadable."""
    try:
        with open(path, encoding="utf-8-sig") as settings_file:
            document = json.load(settings_file)
    except (OSError, ValueError):
        return {}
    return settings_target(document) if isinstance(document, dict) else {}


def is_whole_number(value):
    """An integer field's value: a JSON true is not one, though Python's bool is an int."""
    return isinstance(value, int) and not isinstance(value, bool)


def worker_base_url():
    """Where the worker listens, found the way the harness client finds it (resolveHarnessWorkerUrl in src/integrations/harness-worker.ts):
    the environment, else the port and host in settings.json under CLAUDE_MEM_DATA_DIR or ~/.claude-mem. This only locates the worker.
    The worker's ledger folder and database are never worked out here: the worker uses its own."""
    settings_folder = expand_home(os.environ.get("CLAUDE_MEM_DATA_DIR") or os.path.join(os.path.expanduser("~"), ".claude-mem"))
    settings = read_settings(os.path.join(settings_folder, "settings.json"))
    port = os.environ.get("CLAUDE_MEM_WORKER_PORT") or settings.get("CLAUDE_MEM_WORKER_PORT") or str(37700 + (os.getuid() if hasattr(os, "getuid") else 77) % 100)
    host = os.environ.get("CLAUDE_MEM_WORKER_HOST") or settings.get("CLAUDE_MEM_WORKER_HOST") or "127.0.0.1"
    host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    return f"http://{host}:{port}"


def request_timeout():
    """Seconds to wait on the worker: CLAUDE_MEM_WORKER_TIMEOUT_SECONDS when set, else 30. A value that is not a finite number
    above 0 and at most 3600 is refused with its name, before anything is sent."""
    raw = os.environ.get("CLAUDE_MEM_WORKER_TIMEOUT_SECONDS")
    if raw is None or raw.strip() == "":
        return DEFAULT_TIMEOUT_SECONDS
    try:
        seconds = float(raw)
    except ValueError:
        seconds = math.nan
    if not math.isfinite(seconds) or seconds <= 0 or seconds > MAX_TIMEOUT_SECONDS:
        sys.exit(f"CLAUDE_MEM_WORKER_TIMEOUT_SECONDS must be a positive number of seconds, at most {MAX_TIMEOUT_SECONDS:g}; got {raw!r}. Nothing was written.")
    return seconds


class WorkerFailure(Exception):
    """A request the worker did not accept. `applied` is False when it never took the request or refused it whole (nothing was
    written by it), None when the request was sent and no answer came back, so the worker may have applied it. `problems` are the
    worker's own list of what it refused. `ambiguous` is the worker's own statement that it rolled the rows back but the rules file may
    hold the new rules."""

    def __init__(self, message, applied, problems=None, ambiguous=False):
        super().__init__(message)
        self.applied = applied
        self.problems = problems or []
        self.ambiguous = ambiguous


def refusal_problems(body):
    """The problems a refusal's JSON body lists, or [] when it is not the save route's own refusal."""
    try:
        problems = json.loads(body).get("problems")
    except (ValueError, AttributeError):
        return []
    return [str(problem) for problem in problems] if isinstance(problems, list) else []


def refusal_ambiguous(body):
    """True when a refusal's JSON body says the rows were rolled back but the rules file may hold the new rules."""
    try:
        return json.loads(body).get("ambiguous") is True
    except (ValueError, AttributeError):
        return False


def worker_request(base_url, path, body=None, timeout=DEFAULT_TIMEOUT_SECONDS):
    """One request to the worker; answers its text, or raises WorkerFailure. urllib raises URLError only for a failure while
    connecting or sending, when the worker never had the whole request. A timeout or a lost connection after the request went
    out (an OSError or HTTPException that is not a URLError) is ambiguous for a POST: the worker may have applied it."""
    request = urllib.request.Request(base_url + path, method="POST" if body is not None else "GET",
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"} if body is not None else {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode()
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        raise WorkerFailure(f"worker refused {path}: {error.code} {text}", applied=False, problems=refusal_problems(text),
                            ambiguous=refusal_ambiguous(text))
    except urllib.error.URLError as error:
        raise WorkerFailure(f"claude-mem worker is not reachable at {base_url} ({error.reason}). Start it with: npx claude-mem start", applied=False)
    except (OSError, http.client.HTTPException) as error:
        reason = str(error) or type(error).__name__
        raise WorkerFailure(f"claude-mem worker at {base_url} did not answer {path} ({reason})", applied=False if body is None else None)


def comparable(text):
    # Quote marks inside a quote are often switched between ' and "; they compare equal.
    # Pasted JSON escapes them with a backslash.
    text = re.sub(r"\\?[\u2018\u2019\u201c\u201d\"']", "'", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def prompts_by_minute(prompts_path):
    sections = {}
    current_minute = None
    for line in open(prompts_path, errors="ignore"):
        header = re.match(r"## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ", line)
        if header:
            current_minute = header.group(1)
            sections.setdefault(current_minute, [])
        elif current_minute:
            sections[current_minute].append(line)
    return {minute: comparable("".join(lines)) for minute, lines in sections.items()}


def label(item):
    return item.get("title") or item.get("then")


def drop_aged_quotes(goals, prompts):
    """Remove quotes older than the prompts file's first minute, and items they leave without one. Returns those items' titles.
    With no prompts in the window, every quote is outside it."""
    first_minute = min(prompts, default=None)
    aged_out = []
    for kind_key in ITEM_KEYS:
        kept = []
        for item in goals.get(kind_key, []):
            quotes = item.get("evidence") or []
            item["evidence"] = [quote for quote in quotes if first_minute is not None and str(quote.get("at", ""))[:16] >= first_minute]
            if quotes and not item["evidence"]:
                aged_out.append(label(item))
            else:
                kept.append(item)
        goals[kind_key] = kept
    return aged_out


def drop_unverifiable_carried_quotes(goals, prompts, carried_before):
    """Quotes dated before carried_before came from goals saved earlier, already checked then. One that no longer
    matches (its words were inside a <private> block, which the export now strips) is dropped, not refused, so
    one old quote cannot stop every later refresh. Items left without a quote go too. Returns what was dropped."""
    dropped = []
    for kind_key in ITEM_KEYS:
        kept = []
        for item in goals.get(kind_key, []):
            quotes = item.get("evidence") or []
            item["evidence"] = [quote for quote in quotes
                                if str(quote.get("at", ""))[:16] >= carried_before or not unverified_quotes({"asks": [{"evidence": [quote]}]}, prompts)]
            dropped += [f'{label(item)}: {quote.get("at")}' for quote in quotes if quote not in item["evidence"]]
            if not quotes or item["evidence"]:
                kept.append(item)
        goals[kind_key] = kept
    return dropped


def unverified_quotes(goals, prompts):
    problems = []
    for kind_key in ITEM_KEYS:
        for item in goals.get(kind_key, []):
            for quote in item.get("evidence", []):
                at, text = str(quote.get("at", "")), str(quote.get("quote", ""))
                prompt = prompts.get(at[:16])
                pieces = [comparable(piece).strip(" .,;:!?\"'") for piece in re.split(r"\.\.\.|…", text)]
                long_pieces = [piece for piece in pieces if len(piece) >= 3]
                # A whole quote under 3 characters ("hi", "ok") was always refused, so a window whose only
                # prompt was one failed every refresh (Oct 26). It counts when it is a whole word of the prompt.
                short_pieces = [] if long_pieces else [piece for piece in pieces if piece]
                if prompt is None:
                    problems.append(f'{label(item)}: no owner prompt at {at!r}')
                elif short_pieces:
                    if any(not re.search(rf"(?<!\w){re.escape(piece)}(?!\w)", prompt) for piece in short_pieces):
                        problems.append(f'{label(item)}: quote not in the {at} prompt: "{text}"')
                elif not long_pieces or any(piece not in prompt for piece in long_pieces):
                    problems.append(f'{label(item)}: quote not in the {at} prompt: "{text}"')
    return problems


def shape_problems(goals):
    """What keeps this file from being read as focus areas, asks and rules: its own shape, before its quotes can be checked.
    How long a name or a rule may be, and what a number may hold, is the worker's call (POST /api/work-view/owner-goals/save)."""
    old_keys = [key for key in ("priorities", "open_asks") if key in goals]
    if old_keys:
        return [f'{", ".join(old_keys)}: the old shape. Sort every item into "focus_areas", "asks" or "rules" with the three tests']
    problems = []
    for key in ITEM_KEYS:
        items = goals.get(key, [])
        if not isinstance(items, list):
            problems.append(f'"{key}" must be a list')
        elif not all(isinstance(item, dict) for item in items):
            problems.append(f'every item of "{key}" must be an object')
    if problems:
        return problems
    area_titles = [str(area.get("title") or "").strip() for area in goals.get("focus_areas", [])]
    for area in goals.get("focus_areas", []):
        title = str(area.get("title") or "").strip()
        if not title:
            problems.append('a focus area needs a "title"')
        if not str(area.get("goal") or "").strip():
            problems.append(f'focus area {title!r}: a one-sentence "goal"')
        if not is_whole_number(area.get("rank")):
            problems.append(f'focus area {title!r}: "rank" must be a whole number')
        if "matches" not in area or not (area["matches"] is None or (isinstance(area["matches"], str) and area["matches"].strip())):
            problems.append(f'focus area {title!r}: "matches" must be the saved focus area id it already is, or null for a new area')
    for ask in goals.get("asks", []):
        if "focus_area" not in ask:
            problems.append(f'ask {ask.get("title")!r}: "focus_area" must name one of this answer\'s focus_areas titles, or be null')
        elif ask["focus_area"] is not None and ask["focus_area"] not in area_titles:
            problems.append(f'ask {ask.get("title")!r}: focus_area {ask["focus_area"]!r} is not a title in this answer\'s focus_areas')
    for rule in goals.get("rules", []):
        if not isinstance(rule.get("when", ""), str):
            problems.append(f'rule {rule_text(rule)!r}: "when" must be text (empty for always)')
    # A JSON true is a boolean, not a count: the worker would store it as one.
    for key, value in [("window_days", goals.get("window_days")), ("source_prompt_count", goals.get("source_prompt_count"))] \
            + [("times_asked", item.get("times_asked")) for kind_key in ITEM_KEYS for item in goals.get(kind_key, [])]:
        if isinstance(value, bool):
            problems.append(f'"{key}" must be a whole number, not true or false')
    return problems


def rule_text(rule):
    """A rule's "then", as text."""
    return str(rule.get("then") or "").strip()


def print_focus_areas(base_url, timeout):
    try:
        view = json.loads(worker_request(base_url, "/api/work-view", timeout=timeout))
    except WorkerFailure as failure:
        sys.exit(str(failure))
    if "focusAreas" not in view:
        sys.exit("this claude-mem worker predates My Focus; update claude-mem and restart the worker")
    print(json.dumps([{"focusAreaId": area["focusAreaId"], "name": area["name"], "goal": area["goal"], "status": area["status"],
                       "mergedInto": area["mergedInto"]} for area in view["focusAreas"]], indent=2))


def build_request(args, goals, dry_run):
    """The one request a save sends: the goals the checks above left, the period and map, and the folder to assert, if one was named."""
    request = {
        "goals": {key: goals.get(key) for key in ("generated_at", "window_days", "source_prompt_count", "human_summary")},
        "period": {"start": args.start.isoformat(), "end": args.end.isoformat()} if args.start else None,
        "mapPath": os.path.abspath(args.map) if args.map else None,
    }
    for key in ITEM_KEYS:
        request["goals"][key] = goals.get(key, [])
    if args.ledger_dir:
        request["ledgerDir"] = os.path.abspath(args.ledger_dir)
    if dry_run:
        request["dryRun"] = True
    return request


def not_applied(failure):
    """A save the worker did not apply: every problem it listed, and that nothing was written (exit 1)."""
    if failure.problems:
        detail = "the worker refused this save:\n- " + "\n- ".join(failure.problems)
    elif "refused " + SAVE_PATH + ": 404" in str(failure):
        detail = f"this claude-mem worker predates the owner-goals save ({SAVE_PATH}); update claude-mem and restart the worker"
    else:
        detail = str(failure)
    if failure.ambiguous:
        print(f"{detail}\nThe rows were rolled back, but the rules file may hold the new rules. Run the same command again after fixing the cause: "
              "every save replaces the owner-goals rules in that file, so the rerun replaces the same ones.", file=sys.stderr)
        sys.exit(MAY_HAVE_APPLIED_EXIT)
    sys.exit(f"{detail}\nNothing was written. Fix the cause and run it again.")


def may_have_applied(detail):
    """A save sent whose answer is not known (exit 3): the worker may or may not have applied it."""
    print(f"{detail}\nThe worker may or may not have applied this save. Run the same command again: the save is recognized by its content, so one "
          "the worker already applied changes nothing. Do not ask for a new answer first, as it would suggest its new focus areas a second time.", file=sys.stderr)
    sys.exit(MAY_HAVE_APPLIED_EXIT)


def send_save(base_url, timeout, request):
    """Send the save and answer the worker's reply. Exits 1 when it was refused whole, 3 when no answer came back."""
    try:
        return json.loads(worker_request(base_url, SAVE_PATH, request, timeout=timeout))
    except WorkerFailure as failure:
        if failure.applied is None:
            may_have_applied(str(failure))
        not_applied(failure)
    except ValueError as error:
        may_have_applied(f"the worker answered the save with something that is not JSON ({error})")
    except Exception:
        traceback.print_exc()
        may_have_applied("save_goals.py failed unexpectedly while the save was out")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--goals", help="owner-goals.json from the map step")
    parser.add_argument("--prompts", help="owner-prompts.md the map was built from")
    parser.add_argument("--map", help="owner-map.md, recorded on the list so the full map can be found")
    parser.add_argument("--start", type=datetime.date.fromisoformat, help="first day the prompts cover, YYYY-MM-DD")
    parser.add_argument("--end", type=datetime.date.fromisoformat, help="day after the last day the prompts cover, YYYY-MM-DD")
    parser.add_argument("--carried-before", help="local minute the saved goals were exported, YYYY-MM-DD HH:MM: an older quote that no longer matches is dropped instead of refused")
    parser.add_argument("--ledger-dir", help="assert the folder the worker writes story.json in; the worker refuses any other (default: the worker's own folder)")
    parser.add_argument("--dry-run", action="store_true", help="validate and print the request without saving; the worker plans and checks the save when it answers")
    parser.add_argument("--print-focus-areas", action="store_true", help="print the saved focus areas to match against, then exit")
    args = parser.parse_args()
    timeout = request_timeout()
    base_url = worker_base_url()
    if args.print_focus_areas:
        print_focus_areas(base_url, timeout)
        return
    if not args.goals or not args.prompts:
        sys.exit("--goals and --prompts are required")
    if bool(args.start) != bool(args.end) or (args.start and args.end <= args.start):
        sys.exit("--start and --end go together, and --end must be after --start")

    goals = json.load(open(args.goals))
    problems = shape_problems(goals)
    if problems:
        sys.exit("the goals JSON is not in the saved shape:\n- " + "\n- ".join(problems))
    prompts = prompts_by_minute(args.prompts)
    aged_out = drop_aged_quotes(goals, prompts)
    dropped_carried = drop_unverifiable_carried_quotes(goals, prompts, args.carried_before) if args.carried_before else []
    areas, asks, rules = goals.get("focus_areas", []), goals.get("asks", []), goals.get("rules", [])
    # An ask whose area aged out of the window keeps its words but no longer names an area; it is reported.
    kept_titles = {str(area["title"]).strip() for area in areas}
    unlinked_asks = [ask.get("title") for ask in asks if ask.get("focus_area") is not None and ask["focus_area"] not in kept_titles]
    for ask in asks:
        if ask.get("title") in unlinked_asks:
            ask["focus_area"] = None
    missing = [f'{kind} {label(item)!r}' for kind, items in (("focus area", areas), ("ask", asks), ("rule", rules))
               for item in items if not label(item) or not item.get("evidence")]
    # An empty snapshot is valid only when the window emptied it (every quote aged out, or no prompts in it);
    # an answer that names nothing while there are prompts is refused.
    if (not areas and not asks and not rules and not aged_out and not dropped_carried and prompts) or missing:
        sys.exit("every focus area, ask and rule needs a title (a rule: its then) and at least one evidence quote: " + ", ".join(missing or ["no items"]))
    problems = unverified_quotes(goals, prompts)
    if problems:
        sys.exit("these quotes are not the owner's words at that time; fix them in the goals JSON:\n- " + "\n- ".join(problems))
    titles = [f'{KIND_LABELS["focus-area"]}: {str(area["title"]).strip()}' for area in areas] + [f'{KIND_LABELS["ask"]}: {str(ask["title"]).strip()}' for ask in asks]
    if len(set(titles)) != len(titles):
        sys.exit("two items share a title; give each focus area and ask its own title")

    if args.dry_run:
        dry_run(base_url, timeout, build_request(args, goals, True), unlinked_asks)
        return
    reply = send_save(base_url, timeout, build_request(args, goals, False))
    try:
        summary = {"saved_focus_areas": reply["savedFocusAreas"], "saved_asks": reply["savedAsks"], "saved_rules": reply["savedRules"],
                   "new_focus_areas": reply["newFocusAreas"], "dropped_previous_items": reply["droppedPreviousItems"],
                   "already_applied": reply["alreadyApplied"], "rules_file": reply["rulesFile"], "list": reply["list"], "history": reply["history"]}
        if reply["applied"] is not True:
            raise KeyError("applied")
    except (KeyError, TypeError) as error:
        may_have_applied(f"the worker's answer to the save was not the one expected (missing {error})")
    print(json.dumps({**summary, "aged_out_items": aged_out, "dropped_carried_quotes": dropped_carried, "unlinked_asks": unlinked_asks,
                      "rules_not_saved_for_past_month": len(rules) if summary["history"] else 0, "view": f"{base_url}/#cards"}))


def dry_run(base_url, timeout, request, unlinked_asks):
    """Print what a save would send and write. The worker plans and checks the save too when a worker answers; with none, the output says it was skipped."""
    try:
        reply = json.loads(worker_request(base_url, SAVE_PATH, request, timeout=timeout))
        worker = {"checked": True, **reply}
    except WorkerFailure as failure:
        if failure.applied is None:
            sys.exit(f"{failure}\nA dry run writes nothing; run it again.")
        # A dry run writes nothing, so a worker that is not there, or that predates the save route, only means its check is skipped.
        if failure.problems or ("not reachable" not in str(failure) and "refused " + SAVE_PATH + ": 404" not in str(failure)):
            not_applied(failure)
        worker = {"skipped": str(failure)}
    except ValueError as error:
        sys.exit(f"the worker answered the dry run with something that is not JSON ({error}); nothing was written")
    print(json.dumps({"request": {key: value for key, value in request.items() if key != "dryRun"}, "unlinked_asks": unlinked_asks, "worker": worker}, indent=2))


if __name__ == "__main__":
    main()
