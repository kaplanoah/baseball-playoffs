"""What changed between two standings tables, as update-log entries.

The routine runs this instead of comparing the tables by eye: that is how the
Orioles' elimination went unlogged. It reads five JSON files and prints a
JSON list of log entries WITHOUT `at`; the routine adds that and appends
every entry, in order, in the same write as the change itself.

  python3 changes.py project NEW_STANDINGS
  python3 changes.py OLD_STANDINGS NEW_STANDINGS OLD_TEAMS NEW_TEAMS GAMES LOG BASELINE

The first form prints the projected field (`teams`) from the table you built,
so the projection is computed, not judged. The second prints the log entries.

OLD_STANDINGS / NEW_STANDINGS: the standings document as read and as built
({divisions: {...}}). OLD_TEAMS / NEW_TEAMS: the season document's `teams`
as read and as it will be written. Pass the same file twice for the teams
when the field did not change. GAMES: the `games` list the routine writes
to `slate.today` (away, home, state, score), from which each entry gets its
`via` -- the finals behind it -- so the log says WHY: "Orioles eliminated —
White Sox beat the Royals 9-1". LOG: the season document's `log` as read.
BASELINE: the `routine/baseline` document -- what was already clinched or
eliminated when the log began.

Comparing the two tables catches what changed on this run. The last part,
the CATCH-UP, catches what an earlier run missed, whatever the reason: every
club MLB currently marks as eliminated or clinched must have a log entry (or
be in the baseline), and any that doesn't gets one now, marked `late`. That
is the check that would have caught the White Sox, the Blue Jays and the
wild card clinches that went unlogged for days.
"""
import json
import sys


def rows(doc):
    """Every club's standings row, by id, with its division."""
    out = {}
    for div, clubs in (doc.get("divisions") or {}).items():
        for r in clubs:
            out[r["id"]] = dict(r, div=div)
    return out


def out_of_it(r):
    return r.get("elim") == "E" and r.get("wce") == "E"


def games(v):
    try:
        return float(str(v).lstrip("+"))
    except ValueError:
        return 0.0  # "-": leading, or level with the spot


def best_back(r):
    """Games back on the club's best remaining route: its division, or the
    wild card, whichever it is still alive for and closer in."""
    routes = []
    if r.get("elim") != "E":
        routes.append(games(r.get("gb")))
    if r.get("wce") != "E":
        routes.append(games(r.get("wcgb")))
    return f"{min(routes):.1f}" if routes else None


def result(games, club):
    """A club's final today as a `via` item, own runs first, or None."""
    for g in games:
        if g.get("state") != "final" or club not in (g["away"], g["home"]):
            continue
        a, h = g["score"]
        own, opp_runs, opp = (a, h, g["home"]) if g["away"] == club else (h, a, g["away"])
        return {"team": club, "won": own > opp_runs, "opp": opp, "score": [own, opp_runs]}
    return None


def via(*items):
    return [v for v in items if v]


def last_wild_card(after, league_of, lg):
    """The club holding the league's last wild card spot."""
    holders = [r for i, r in after.items()
               if league_of(i) == lg and r.get("wcrank") and not r.get("lead")]
    holders.sort(key=lambda r: int(r["wcrank"]))
    return holders[2]["id"] if len(holders) >= 3 else None


CLINCH_WHAT = {"x": "playoff", "w": "wildcard", "y": "division", "z": "bye"}
CLINCH_STEP = {"x": 1, "w": 2, "y": 3, "z": 4}
STEP_OF_WHAT = {w: CLINCH_STEP[c] for c, w in CLINCH_WHAT.items()}


def catch_up(after, entries, log, baseline):
    """Entries for anything MLB shows that neither the log, the baseline, nor
    this run's entries account for."""
    seen = list(log) + list(entries)
    out_logged = set(baseline.get("out", [])) | {e.get("team") for e in seen if e.get("kind") == "elim"}
    step = {i: CLINCH_STEP.get(c, 0) for i, c in (baseline.get("clinch") or {}).items()}
    for e in seen:
        if e.get("kind") == "berth":
            step[e["team"]] = max(step.get(e["team"], 0), STEP_OF_WHAT.get(e.get("what"), 0))
    late = []
    for i, r in after.items():
        c = r.get("clinch")
        if c in CLINCH_STEP and CLINCH_STEP[c] > step.get(i, 0):
            e = {"kind": "berth", "team": i, "what": CLINCH_WHAT[c], "late": True}
            if e["what"] == "division":
                e["div"] = r["div"]
            late.append(e)
    for i, r in after.items():
        if out_of_it(r) and i not in out_logged:
            late.append({"kind": "elim", "team": i, "late": True})
    return late


def project(st):
    """The field if the season ended today, per league: the three division
    leaders seeded 1-3 by win percentage, then the top three by wild card
    rank seeded 4-6. Ties keep MLB's own order (the table is in it)."""
    teams = {}
    for lg in ("AL", "NL"):
        divs = [d for d in st["divisions"] if d.startswith(lg)]
        leaders = [next(r for r in st["divisions"][d] if r.get("lead")) for d in divs]
        leaders.sort(key=lambda r: -float(r["pct"]))
        wild = sorted((r for d in divs for r in st["divisions"][d] if r.get("wcrank") and not r.get("lead")),
                      key=lambda r: int(r["wcrank"]))[:3]
        for seed, r in enumerate(leaders + wild, 1):
            teams[r["id"]] = {"league": lg, "seed": seed, "w": r["w"], "l": r["l"]}
    return teams


def main(old_st, new_st, old_teams, new_teams, games, log=None, baseline=None):
    before, after = rows(old_st), rows(new_st)
    entries = []
    league_of = lambda i: after[i]["div"][:2] if i in after else ""

    # The field: who came in, who went out, per league, paired in seed order.
    for lg in ("AL", "NL"):
        ins = sorted((i for i, t in new_teams.items() if t["league"] == lg and i not in old_teams),
                     key=lambda i: new_teams[i]["seed"])
        outs = sorted((i for i, t in old_teams.items() if t["league"] == lg and i not in new_teams),
                      key=lambda i: old_teams[i]["seed"])
        for i, o in zip(ins, outs):
            e = {"kind": "field", "in": i, "out": o}
            v = via(result(games, i), result(games, o))
            if v:
                e["via"] = v
            if new_teams[i]["seed"] <= 3:
                e.update(spot="division", div=after.get(i, {}).get("div", ""))
            else:
                e["spot"] = "wildcard"
            r = after.get(o)
            if r:
                e["outAlive"] = not out_of_it(r)
                back = best_back(r)
                if back is not None:
                    e["outBack"] = back
            entries.append(e)
        for i in ins[len(outs):]:
            entries.append({"kind": "field", "in": i})
        for o in outs[len(ins):]:
            entries.append({"kind": "field", "out": o})

    # Seed moves among clubs that stayed in the field: only moves UP, since
    # every move up implies one down. `over` names the club passed when the
    # two simply swapped seeds.
    for lg in ("AL", "NL"):
        stayed = [i for i, t in new_teams.items() if t["league"] == lg and i in old_teams]
        for i in sorted(stayed, key=lambda i: new_teams[i]["seed"]):
            was, now = old_teams[i]["seed"], new_teams[i]["seed"]
            if now >= was:
                continue
            e = {"kind": "seed", "team": i, "from": was, "to": now}
            swap = [j for j in stayed if old_teams[j]["seed"] == now and new_teams[j]["seed"] == was]
            if swap:
                e["over"] = swap[0]
            v = via(result(games, i), result(games, e["over"]) if swap else None)
            if v:
                e["via"] = v
            entries.append(e)

    # Clinches on this run, from MLB's clinchIndicator (`clinch` in the table):
    # x a playoff spot, w a wild card, y the division, z a first-round bye.
    # Each step up is its own news -- the White Sox clinching a spot and,
    # later, a wild card are two entries. A table read before `clinch` was
    # recorded has nothing to compare against, so only division titles (from
    # `clinched`) can be found then.
    WHAT, STEP = CLINCH_WHAT, CLINCH_STEP
    for i, r in after.items():
        old = before.get(i, {})
        if "clinch" in old:
            new_c, old_c = r.get("clinch"), old.get("clinch")
            if new_c not in WHAT or STEP[new_c] <= STEP.get(old_c, 0):
                continue
            e = {"kind": "berth", "team": i, "what": WHAT[new_c]}
        elif r.get("clinched") and not old.get("clinched"):
            e = {"kind": "berth", "team": i, "what": "division"}
        else:
            continue
        if e["what"] == "division":
            e["div"] = r["div"]
        own = result(games, i)
        if own and own["won"]:
            e["via"] = [own]
        entries.append(e)

    # Clubs whose season ended on this run: out of the division AND the wild card.
    # Why: its own loss, and the win by the club it was chasing on the route
    # that closed this run -- the division leader, or the last wild card.
    for i, r in after.items():
        if out_of_it(r) and not out_of_it(before.get(i, {})):
            e = {"kind": "elim", "team": i}
            old = before.get(i, {})
            chasing = None
            if old.get("wce") != "E":
                chasing = last_wild_card(after, league_of, league_of(i))
            elif old.get("elim") != "E":
                chasing = next((x for x, rr in after.items() if rr["div"] == r["div"] and rr.get("lead")), None)
            own = result(games, i)
            them = result(games, chasing) if chasing else None
            v = via(own if own and not own["won"] else None, them if them and them["won"] else None)
            if v:
                e["via"] = v
            entries.append(e)

    if log is not None:
        entries += catch_up(after, entries, log, baseline or {})
    return entries


if __name__ == "__main__":
    if sys.argv[1] == "project":
        # python3 changes.py project NEW_STANDINGS: the projected `teams`.
        print(json.dumps(project(json.load(open(sys.argv[2]))), indent=1))
        sys.exit()
    docs = [json.load(open(p)) for p in sys.argv[1:8]]
    if len(docs) > 5:
        # The season document as read: its log. The baseline document as read.
        docs[5] = docs[5].get("log", docs[5]) if isinstance(docs[5], dict) else docs[5]
    print(json.dumps(main(*docs), indent=1))
