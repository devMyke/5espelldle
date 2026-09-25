"""
Builds spells.js for 5eSpellDLE.

Sources (clone these next to the project, then run the script):
  git clone --depth 1 https://github.com/5e-bits/5e-database.git            # SRD 5.1 spells (CC BY 4.0), with descriptions
  git clone --depth 1 https://github.com/nick-aschenbach/dnd-data.git       # stats for non-SRD spells + which book they're from
  git clone --depth 1 https://github.com/mattearly/DnD_5e_Perfect_Spells.git # class lists for Player's Handbook spells

  python tools/build_spells.py

Only game-mechanical facts (level, range, classes...) are kept for non-SRD spells.
No rules text from outside the SRD is written into spells.js.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRD_FILE = ROOT / "5e-database/src/2014/en/5e-SRD-Spells.json"
DND_DATA = ROOT / "dnd-data/data/spells.json"
PHB_FILE = ROOT / "DnD_5e_Perfect_Spells/allSpells.json"
OUT = ROOT / "spells.js"

# Books in publication order. The first book a spell appears in is its source.
BOOKS = [  # (name in dnd-data, short label shown on the tile)
    ("Player's Handbook", "PHB"),
    ("Sword Coast Adventurer's Guide", "SCAG"),
    ("Xanathar's Guide to Everything", "Xanathar's"),
    ("Tasha's Cauldron of Everything", "Tasha's"),
    ("Fizban's Treasury of Dragons", "Fizban's"),
    ("Strixhaven A Curriculum of Chaos", "Strixhaven"),
]

# Class lists for spells outside the Player's Handbook, as printed in each book
# (no Artificer, no Tasha's optional class-list additions). Fix mistakes here.
CLASSES = {
    # Player's Handbook spells missing from the PHB class dataset
    "Arcane Gate": "Sor Wlk Wiz",
    # Sword Coast Adventurer's Guide
    "Booming Blade": "Sor Wlk Wiz", "Green-Flame Blade": "Sor Wlk Wiz",
    "Lightning Lure": "Sor Wlk Wiz", "Sword Burst": "Sor Wlk Wiz",
    # Xanathar's Guide to Everything
    "Abi-Dalzim's Horrid Wilting": "Sor Wiz", "Absorb Elements": "Drd Rgr Sor Wiz",
    "Aganazzar's Scorcher": "Sor Wiz", "Beast Bond": "Drd Rgr", "Bones of the Earth": "Drd",
    "Catapult": "Sor Wiz", "Catnap": "Brd Sor Wiz", "Cause Fear": "Wlk Wiz",
    "Ceremony": "Clr Pal", "Chaos Bolt": "Sor", "Charm Monster": "Brd Drd Sor Wlk Wiz",
    "Control Flames": "Drd Sor Wiz", "Control Winds": "Drd Sor Wiz",
    "Create Bonfire": "Drd Sor Wlk Wiz", "Create Homunculus": "Wiz",
    "Crown of Stars": "Sor Wlk Wiz", "Danse Macabre": "Wlk Wiz", "Dawn": "Clr Wiz",
    "Dragon's Breath": "Sor Wiz", "Druid Grove": "Drd", "Dust Devil": "Drd Sor Wiz",
    "Earth Tremor": "Brd Drd Sor Wiz", "Earthbind": "Drd Sor Wlk Wiz",
    "Elemental Bane": "Drd Wlk Wiz", "Enemies Abound": "Brd Sor Wlk Wiz",
    "Enervation": "Sor Wlk Wiz", "Erupting Earth": "Drd Sor Wiz", "Far Step": "Sor Wlk Wiz",
    "Find Greater Steed": "Pal", "Flame Arrows": "Drd Rgr Sor Wiz",
    "Frostbite": "Drd Sor Wlk Wiz", "Guardian of Nature": "Drd Rgr", "Gust": "Drd Sor Wiz",
    "Healing Spirit": "Drd Rgr", "Holy Weapon": "Clr Pal", "Ice Knife": "Drd Sor Wiz",
    "Illusory Dragon": "Wiz", "Immolation": "Sor Wiz", "Infernal Calling": "Wlk Wiz",
    "Infestation": "Drd Sor Wlk Wiz", "Investiture of Flame": "Drd Sor Wlk Wiz",
    "Investiture of Ice": "Drd Sor Wlk Wiz", "Investiture of Stone": "Drd Sor Wlk Wiz",
    "Investiture of Wind": "Drd Sor Wlk Wiz", "Invulnerability": "Wiz",
    "Life Transference": "Clr Wiz", "Maddening Darkness": "Wlk Wiz", "Maelstrom": "Drd",
    "Magic Stone": "Drd Wlk", "Mass Polymorph": "Brd Sor Wiz",
    "Maximillian's Earthen Grasp": "Sor Wiz", "Melf's Minute Meteors": "Sor Wiz",
    "Mental Prison": "Sor Wlk Wiz", "Mighty Fortress": "Wiz", "Mind Spike": "Sor Wlk Wiz",
    "Mold Earth": "Drd Sor Wiz", "Negative Energy Flood": "Wlk Wiz",
    "Power Word Pain": "Sor Wlk Wiz", "Primal Savagery": "Drd", "Primordial Ward": "Drd",
    "Psychic Scream": "Brd Sor Wlk Wiz", "Pyrotechnics": "Brd Sor Wiz",
    "Scatter": "Sor Wlk Wiz", "Shadow Blade": "Sor Wlk Wiz", "Shadow of Moil": "Wlk",
    "Shape Water": "Drd Sor Wiz", "Sickening Radiance": "Sor Wlk Wiz",
    "Skill Empowerment": "Brd Sor Wiz", "Skywrite": "Brd Drd Wiz", "Snare": "Drd Rgr Wiz",
    "Snilloc's Snowball Swarm": "Sor Wiz", "Soul Cage": "Wlk Wiz",
    "Steel Wind Strike": "Rgr Wiz", "Storm Sphere": "Sor Wiz",
    "Summon Greater Demon": "Wlk Wiz", "Summon Lesser Demons": "Wlk Wiz",
    "Synaptic Static": "Brd Sor Wlk Wiz", "Temple of the Gods": "Clr",
    "Tenser's Transformation": "Wiz", "Thunder Step": "Sor Wlk Wiz",
    "Thunderclap": "Brd Drd Sor Wlk Wiz", "Tidal Wave": "Drd Sor Wiz", "Tiny Servant": "Wiz",
    "Toll the Dead": "Clr Wlk Wiz", "Transmute Rock": "Drd Wiz", "Vitriolic Sphere": "Sor Wiz",
    "Wall of Light": "Sor Wlk Wiz", "Wall of Sand": "Wiz", "Wall of Water": "Drd Sor Wiz",
    "Warding Wind": "Brd Drd Sor Wiz", "Watery Sphere": "Drd Sor Wiz",
    "Whirlwind": "Drd Sor Wiz", "Word of Radiance": "Clr", "Wrath of Nature": "Drd Rgr",
    "Zephyr Strike": "Rgr",
    # Tasha's Cauldron of Everything
    "Blade of Disaster": "Sor Wlk Wiz", "Dream of the Blue Veil": "Brd Sor Wlk Wiz",
    "Intellect Fortress": "Brd Sor Wlk Wiz", "Mind Sliver": "Sor Wlk Wiz",
    "Spirit Shroud": "Clr Pal Wlk Wiz", "Summon Aberration": "Wlk Wiz",
    "Summon Beast": "Drd Rgr", "Summon Celestial": "Clr Pal", "Summon Construct": "Wiz",
    "Summon Elemental": "Drd Rgr Wiz", "Summon Fey": "Drd Rgr Wlk Wiz",
    "Summon Fiend": "Wlk Wiz", "Summon Shadowspawn": "Wlk Wiz", "Summon Undead": "Wlk Wiz",
    "Tasha's Caustic Brew": "Sor Wiz", "Tasha's Mind Whip": "Sor Wiz",
    "Tasha's Otherworldly Guise": "Sor Wlk Wiz",
    # Fizban's Treasury of Dragons
    "Ashardalon's Stride": "Rgr Sor Wiz", "Draconic Transformation": "Drd Sor Wiz",
    "Fizban's Platinum Shield": "Sor Wiz", "Nathair's Mischief": "Brd Sor Wiz",
    "Raulothim's Psychic Lance": "Brd Sor Wlk Wiz", "Rime's Binding Ice": "Sor Wiz",
    "Summon Draconic Spirit": "Drd Sor Wiz",
    # Strixhaven: A Curriculum of Chaos
    "Borrowed Knowledge": "Brd Clr Wlk Wiz", "Kinetic Jaunt": "Brd Sor Wiz",
    "Silvery Barbs": "Brd Sor Wiz", "Vortex Warp": "Sor Wiz", "Wither and Bloom": "Drd Sor Wiz",
}
ABBR = {"Brd": "Bard", "Clr": "Cleric", "Drd": "Druid", "Pal": "Paladin",
        "Rgr": "Ranger", "Sor": "Sorcerer", "Wlk": "Warlock", "Wiz": "Wizard"}

# Player spells in Baldur's Gate 3 (levels 0-6), from bg3.wiki's list of all spells.
# BG3-only inventions (Bursting Sinew, Dethrone, ...) are left out: they have no tabletop version.
BG3 = """Acid Splash; Blade Ward; Bone Chill; Booming Blade; Dancing Lights; Eldritch Blast; Fire Bolt;
Friends; Guidance; Light; Mage Hand; Minor Illusion; Poison Spray; Produce Flame; Ray of Frost; Resistance;
Sacred Flame; Shillelagh; Shocking Grasp; Thaumaturgy; Thorn Whip; Toll the Dead; True Strike; Vicious Mockery;
Animal Friendship; Armour of Agathys; Arms of Hadar; Bane; Bless; Burning Hands; Charm Person; Chromatic Orb;
Colour Spray; Command; Compelled Duel; Create or Destroy Water; Cure Wounds; Disguise Self; Dissonant Whispers;
Divine Favour; Enhance Leap; Ensnaring Strike; Entangle; Expeditious Retreat; Faerie Fire; False Life;
Feather Fall; Find Familiar; Fog Cloud; Goodberry; Grease; Guiding Bolt; Hail of Thorns; Healing Word;
Hellish Rebuke; Heroism; Hex; Hunter's Mark; Ice Knife; Inflict Wounds; Longstrider; Mage Armour; Magic Missile;
Protection from Evil and Good; Ray of Sickness; Sanctuary; Searing Smite; Shield; Shield of Faith; Sleep;
Speak with Animals; Tasha's Hideous Laughter; Thunderous Smite; Thunderwave; Witch Bolt; Wrathful Smite;
Aid; Arcane Lock; Barkskin; Blindness/Deafness; Blur; Branding Smite; Calm Emotions; Cloud of Daggers;
Crown of Madness; Darkness; Darkvision; Detect Thoughts; Enhance Ability; Enlarge/Reduce; Enthrall; Flame Blade;
Flaming Sphere; Gust of Wind; Heat Metal; Hold Person; Invisibility; Knock; Lesser Restoration; Magic Weapon;
Melf's Acid Arrow; Mirror Image; Misty Step; Moonbeam; Pass Without Trace; Phantasmal Force; Prayer of Healing;
Protection from Poison; Ray of Enfeeblement; Scorching Ray; See Invisibility; Shadow Blade; Shatter; Silence;
Spike Growth; Spiritual Weapon; Warding Bond; Web;
Animate Dead; Beacon of Hope; Bestow Curse; Blinding Smite; Blink; Call Lightning; Conjure Barrage;
Counterspell; Crusader's Mantle; Daylight; Elemental Weapon; Fear; Feign Death; Fireball; Gaseous Form;
Glyph of Warding; Grant Flight; Haste; Hunger of Hadar; Hypnotic Pattern; Lightning Arrow; Lightning Bolt;
Mass Healing Word; Plant Growth; Protection from Energy; Remove Curse; Revivify; Sleet Storm; Slow;
Speak with Dead; Spirit Guardians; Stinking Cloud; Vampiric Touch;
Banishment; Blight; Confusion; Conjure Minor Elementals; Conjure Woodland Beings; Death Ward; Dimension Door;
Dominate Beast; Evard's Black Tentacles; Fire Shield; Freedom of Movement; Grasping Vine; Greater Invisibility;
Guardian of Faith; Ice Storm; Otiluke's Resilient Sphere; Phantasmal Killer; Polymorph; Staggering Smite;
Stoneskin; Wall of Fire;
Banishing Smite; Cloudkill; Cone of Cold; Conjure Elemental; Contagion; Destructive Wave; Dispel Evil and Good;
Dominate Person; Flame Strike; Greater Restoration; Hold Monster; Insect Plague; Mass Cure Wounds;
Planar Binding; Seeming; Telekinesis; Wall of Stone;
Arcane Gate; Blade Barrier; Chain Lightning; Circle of Death; Create Undead; Disintegrate; Eyebite;
Flesh to Stone; Globe of Invulnerability; Harm; Heal; Heroes' Feast; Otiluke's Freezing Sphere;
Otto's Irresistible Dance; Planar Ally; Sunbeam; Wall of Ice; Wall of Thorns; Wind Walk"""
BG3_RENAMES = {"Bone Chill": "Chill Touch", "Enhance Leap": "Jump", "Grant Flight": "Fly",
               "Armour of Agathys": "Armor of Agathys", "Colour Spray": "Color Spray",
               "Divine Favour": "Divine Favor", "Mage Armour": "Mage Armor"}

# Hand fixes where automatic extraction reads the rules text too literally.
OVERRIDES = {
    "Wish": {"damage": ["None"]},   # the necrotic damage is the caster's stress, not the spell's effect
}

DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
                "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]
ABILITIES = {"strength": "STR", "dexterity": "DEX", "constitution": "CON",
             "intelligence": "INT", "wisdom": "WIS", "charisma": "CHA"}

def norm(name):
    return re.sub(r"[^a-z]", "", name.lower().replace("’", "'"))

def seconds(text):
    m = re.match(r"(\d+)\s+(round|minute|hour|day)s?", text.lower())
    if not m:
        return None
    return int(m.group(1)) * {"round": 6, "minute": 60, "hour": 3600, "day": 86400}[m.group(2)]

def casting_time(raw):
    t = raw.lower().split(",")[0].strip()
    for key, label in (("bonus action", "Bonus action"), ("reaction", "Reaction"), ("action", "Action")):
        if t in (f"1 {key}", key):
            return label, 0          # all in-combat casts share rank 0: no arrow between them
    return raw.split(",")[0].strip(), seconds(raw)

def range_info(raw):
    label = raw.split("(")[0].strip()          # "Self (15-foot cone)" -> "Self"
    r = label.lower()
    fixed = {"self": 0, "touch": 1, "sight": 10**7, "unlimited": 10**9}
    if r in fixed:
        return label, fixed[r]
    m = re.match(r"(\d+)\s+(feet|foot|mile|miles)", r)
    if m:
        n = int(m.group(1))
        return label, n * 5280 if m.group(2).startswith("mile") else n
    return label, None                          # "Special": no arrows

def duration(raw):
    label = re.sub(r"^(concentration,\s*)?up to\s+", "", raw.strip(), flags=re.I)
    label = label[0].upper() + label[1:]
    low = label.lower()
    if low == "instantaneous":
        rank = 0
    elif low.startswith("until dispelled"):
        rank = 10**12
    else:
        rank = seconds(label)
    return label, rank

def effects(text, damage=(), save=(), attack=None):
    dmg = {d.capitalize() for d in damage if d.lower() in DAMAGE_TYPES}
    for t in DAMAGE_TYPES:
        if re.search(rf"\d+d\d+[^.]*?\b{t} damage", text, re.I):
            dmg.add(t.capitalize())
    sv = {f"{ABILITIES[a.lower()]} save" for a in save if a.lower() in ABILITIES}
    for word, abbr in ABILITIES.items():
        if re.search(rf"\b{word} saving throw", text, re.I):
            sv.add(f"{abbr} save")
    if attack:
        sv.add(f"{attack.capitalize()} attack")
    for kind in ("melee", "ranged"):
        if re.search(rf"\b{kind} spell attack", text, re.I):
            sv.add(f"{kind.capitalize()} attack")
    return sorted(dmg) or ["None"], sorted(sv) or ["None"]

def redact(text, names, words=25):
    w = text.split()
    snippet = " ".join(w[:words]) + ("…" if len(w) > words else "")
    for n in names:
        snippet = re.sub(re.escape(n), "▒▒▒▒", snippet, flags=re.I)
    return snippet

# ---------- Load sources ----------
srd = json.load(open(SRD_FILE, encoding="utf-8"))
phb_classes = {norm(s["name"]): s["classes"] for s in
               json.load(open(PHB_FILE, encoding="utf-8"))["allSpells"]}
wotc = [s for s in json.load(open(DND_DATA, encoding="utf-8")) if s["publisher"] == "Wizards of the Coast"]

book_entries = {}   # norm(name) -> (entry, short book label, book index)
for i, (book, short) in enumerate(BOOKS):
    for s in wotc:
        if s["book"] == book and norm(s["name"]) not in book_entries:
            book_entries[norm(s["name"])] = (s, short, i)

# SRD renamed a few PHB spells ("Acid Arrow" is "Melf's Acid Arrow"): find the PHB name.
phb_names = {k: e["name"].replace("’", "'") for k, (e, short, _) in book_entries.items() if short == "PHB"}
SRD_RENAMES = {"Arcane Hand": "Bigby's Hand", "Arcane Sword": "Mordenkainen's Sword",
               "Arcanist's Magic Aura": "Nystul's Magic Aura"}
def phb_name(srd_name):
    k = norm(srd_name)
    if srd_name in SRD_RENAMES:
        return SRD_RENAMES[srd_name]
    if k in phb_names:
        return srd_name                           # same name, keep the SRD's punctuation
    matches = [n for kk, n in phb_names.items() if kk.endswith(k)]
    return matches[0] if len(matches) == 1 else srd_name

spells, used = [], set()

# ---------- SRD spells: full data, with a description clue ----------
for s in srd:
    name = phb_name(s["name"])
    text = " ".join(s["desc"] + s.get("higher_level", []))
    ct, ct_rank = casting_time(s["casting_time"])
    rg, rg_rank = range_info(s["range"])
    du, du_rank = duration(s["duration"])
    damage, save = effects(text, [d["damage_type"]["name"] for d in s.get("damage", []) if "damage_type" in d],
                           [s["dc"]["dc_type"]["name"]] if s.get("dc") else [], s.get("attack_type"))
    spells.append({
        "name": name, "aliases": [s["name"]] if s["name"] != name else [],
        "level": s["level"], "school": s["school"]["name"],
        "castingTime": ct, "castingRank": ct_rank, "range": rg, "rangeFt": rg_rank,
        "components": s["components"], "duration": du, "durationRank": du_rank,
        "tags": [t for t, on in (("Concentration", s["concentration"]), ("Ritual", s["ritual"])) if on] or ["Neither"],
        "classes": sorted(c["name"] for c in s["classes"]),
        "damage": damage, "save": save,
        "book": "PHB", "bookRank": 0,
        "clue": redact(s["desc"][0], {s["name"], name}),
    })
    used.add(norm(name)); used.add(norm(s["name"]))

# ---------- Other books: stats only, parsed from the spell header ----------
HEADER = re.compile(
    r"Casting Time\s*:\s*(?P<ct>.+?)\s+Rang\s?e\s*:\s*(?P<range>.+?)\s+Components\s*:\s*(?P<comp>.+?)\s+"
    r"Duration\s*:\s*(?P<dur>Instantaneous|Special|Until dispelled(?: or triggered)?|"
    r"(?:Concentration,\s*)?(?:up to\s+)?\d+\s+(?:round|minute|hour|day)s?)", re.I)

missing = []
for key, (e, short, idx) in book_entries.items():
    if key in used:
        continue
    name = e["name"].replace("’", "'")
    desc = re.sub(r"(\d) (\d)", r"\1\2", e["description"])      # "3 0 feet" -> "30 feet"
    desc = desc.replace(" minure", " minutes")                     # typo in the source data
    m = HEADER.search(desc)
    if name in CLASSES:
        classes = [ABBR[c] for c in CLASSES[name].split()]
    elif key in phb_classes:
        classes = [c.strip() for c in phb_classes[key].split(",")]
    else:
        classes = None
    if not m or not classes:
        missing.append(f"{name} ({short}): {'header' if not m else 'classes'}")
        continue
    header = desc[:m.start()]
    p = e["properties"]
    ct, ct_rank = casting_time(m["ct"])
    rg, rg_rank = range_info(m["range"])
    du, du_rank = duration(m["dur"])
    comps = [c for c in ("V", "S", "M") if re.search(rf"\b{c}\b", m["comp"].split("(")[0])]
    damage, save = effects(desc[m.end():], [p.get("Damage Type", "")], [p.get("Save", "")])
    tags = (["Concentration"] if m["dur"].lower().startswith("concentration") else []) + \
           (["Ritual"] if "ritual" in header.lower() else [])
    spells.append({
        "name": name, "aliases": [],
        "level": int(p["Level"]), "school": p["School"].capitalize(),
        "castingTime": ct, "castingRank": ct_rank, "range": rg, "rangeFt": rg_rank,
        "components": comps, "duration": du, "durationRank": du_rank,
        "tags": tags or ["Neither"], "classes": sorted(classes),
        "damage": damage, "save": save,
        "book": short, "bookRank": idx,
        "clue": None,   # no rules text outside the SRD
    })
    used.add(key)

# ---------- BG3 flag ----------
by_norm = {norm(s["name"]): s for s in spells}
for s in spells:
    for a in s["aliases"]:
        by_norm.setdefault(norm(a), s)
bg3_missing = []
for raw in re.split(r";\s*", BG3.replace("\n", " ")):
    raw = raw.strip()
    s = by_norm.get(norm(BG3_RENAMES.get(raw, raw)))
    if not s:
        bg3_missing.append(raw)
        continue
    s["bg3"] = True
    if norm(raw) != norm(s["name"]) and raw not in s["aliases"]:
        s["aliases"].append(raw)          # lets players type the BG3 name

for s in spells:
    s.setdefault("bg3", False)
    s.update(OVERRIDES.get(s["name"], {}))

spells.sort(key=lambda x: x["name"])
OUT.write_text("// Generated by tools/build_spells.py - do not edit by hand.\n"
               "const SPELLS = " + json.dumps(spells, ensure_ascii=False, separators=(",", ":")) + ";\n",
               encoding="utf-8")
print(f"Wrote {len(spells)} spells ({sum(s['bg3'] for s in spells)} in BG3) to {OUT.name}")
if missing:    print("Skipped (no data):", "; ".join(missing))
if bg3_missing: print("BG3 names not matched:", "; ".join(bg3_missing))
