"""What changed between two standings tables, as update-log entries.

The routine runs this instead of comparing the tables by eye: that is how the
Orioles' elimination went unlogged. It reads five JSON files and prints a
JSON list of log entries WITHOUT `at`; the routine adds that and appends
every entry, in order, in the same write as the change itself.

  python3 changes.py OLD_STANDINGS NEW_STANDINGS OLD_TEAMS NEW_TEAMS GAMES

OLD_STANDINGS / NEW_STANDINGS: the standings document as read and as built
({divisions: {...}}). OLD_TEAMS / NEW_TEAMS: the season document's `teams`
as read and as it will be written. Pass the same file twice for the teams
when the field did not change. GAMES: the `games` list the routine writes
to `slate.today` (away, home, state, score), from which each entry gets its
`via` -- the finals behind it -- so the log says WHY: "Orioles eliminated —
White Sox beat the Royals 9-1".
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


def main(old_st, new_st, old_teams, new_teams, games):
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

    # Division titles clinched on this run.
    for i, r in after.items():
        if r.get("clinched") and not before.get(i, {}).get("clinched"):
            e = {"kind": "berth", "team": i, "what": "division", "div": r["div"]}
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

    return entries


if __name__ == "__main__":
    docs = [json.load(open(p)) for p in sys.argv[1:6]]
    print(json.dumps(main(*docs), indent=1))
