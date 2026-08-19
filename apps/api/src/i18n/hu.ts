/**
 * Hungarian — the server's half.
 *
 * Keyed by the English source sentence, like every other catalogue here. English has
 * no file of its own because translating into the source language is the identity.
 *
 * **The vocabulary is fixed across the whole app**, and it is worth stating once
 * because inconsistency here is what makes a translated app feel machine-made:
 *
 * | English      | Hungarian     |
 * |--------------|---------------|
 * | trip         | utazás        |
 * | board        | tábla         |
 * | lane         | sáv           |
 * | option       | javaslat      |
 * | decided/lock | eldöntve/rögzít |
 * | member       | tag           |
 * | organiser    | szervező      |
 * | co-organiser | társszervező  |
 * | owner        | tulajdonos    |
 * | participant  | résztvevő     |
 * | guest        | vendég        |
 * | invite link  | meghívó link  |
 *
 * Two habits of Hungarian that shape these strings:
 *
 *  - **no plural after a numeral** — `2 tag`, never `2 tagok`. That is handled by
 *    `plural()` on the front end rather than here, but it is why several counted
 *    phrases read as they do;
 *  - **the polite imperative is the app's register throughout** (`Töltsd ki`,
 *    informal singular), matching the English copy's direct address. Switching to
 *    the formal `Ön` halfway would be worse than either choice consistently.
 */
export const HU_SERVER_MESSAGES: Readonly<Record<string, string>> = {
  "A global link for this role already exists. Disable it first to make a new one.":
    "Ehhez a szerephez már van általános link. Előbb kapcsold ki, utána csinálhatsz újat.",
  "Category not found": "A sáv nem található",
  "Channel not found": "A csatorna nem található",
  "Dates has to stay single-choice — the trip runs over one date range.":
    "A Dátumok sávnak egyválasztósnak kell maradnia — az utazás egyetlen időszakban zajlik.",
  "Google account has no email address.":
    "A Google-fiókhoz nem tartozik e-mail-cím.",
  "Images must be {mb}MB or smaller.": "A kép legfeljebb {mb} MB lehet.",
  "Invalid cursor": "Érvénytelen kurzor",
  "Invalid email or password": "Hibás e-mail-cím vagy jelszó",
  "Invalid or expired verification token":
    "Érvénytelen vagy lejárt megerősítő kód",
  "Invalid unsubscribe link": "Érvénytelen leiratkozó link",
  "Invalid {name}": "Érvénytelen {name}",
  "Invite link not found": "A meghívó link nem található",
  "Member not found": "A tag nem található",
  "Message not found": "Az üzenet nem található",
  "No file was uploaded (field name: file).":
    "Nem töltöttél fel fájlt (a mező neve: file).",
  "No such user.": "Nincs ilyen felhasználó.",
  "Notification not found": "Az értesítés nem található",
  "Only the proposer or an organizer can delete this option.":
    "Ezt a javaslatot csak a beküldője vagy egy szervező törölheti.",
  "Only the proposer or an organizer can edit this option.":
    "Ezt a javaslatot csak a beküldője vagy egy szervező szerkesztheti.",
  "Option not found": "A javaslat nem található",
  "Please verify your email address to do this.":
    "Ehhez előbb meg kell erősítened az e-mail-címedet.",
  "Reorder must list each of the category's options exactly once.":
    "Az átrendezésnek a sáv minden javaslatát pontosan egyszer kell tartalmaznia.",
  "Reorder must list each of the trip's categories exactly once.":
    "Az átrendezésnek az utazás minden sávját pontosan egyszer kell tartalmaznia.",
  "Someone else changed this category's decision. Reload to see the current state.":
    "Valaki más módosította a sáv döntését. Töltsd újra, hogy lásd a jelenlegi állapotot.",
  "Someone else changed this option. Reload to see the current state.":
    "Valaki más módosította ezt a javaslatot. Töltsd újra, hogy lásd a jelenlegi állapotot.",
  "That image couldn't be processed. It may be corrupt.":
    "A képet nem sikerült feldolgozni. Lehet, hogy hibás.",
  "That member must verify their email before becoming a co-organizer.":
    "A tagnak előbb meg kell erősítenie az e-mail-címét, hogy társszervező lehessen.",
  "That member must verify their email before becoming the owner.":
    "A tagnak előbb meg kell erősítenie az e-mail-címét, hogy tulajdonos lehessen.",
  "The Dates category can't be deleted — it's the trip's only way to set its dates.":
    "A Dátumok sáv nem törölhető — csak ezen keresztül lehet megadni az utazás időpontját.",
  "This account has been deleted.": "Ezt a fiókot törölték.",
  "This board is at its limit of {cap} categories. Delete one to add another.":
    "Ez a tábla elérte a {cap} sávos korlátot. Törölj egyet, ha újat szeretnél.",
  "This category was changed since you opened it. Reload to see the latest.":
    "A sáv megváltozott, mióta megnyitottad. Töltsd újra a legfrissebb állapothoz.",
  "This invite link has already been used.":
    "Ezt a meghívó linket már felhasználták.",
  "This invite link has been disabled.": "Ezt a meghívó linket kikapcsolták.",
  "This invite link is invalid.": "Ez a meghívó link érvénytelen.",
  "This option can no longer be locked. Reload to see the current state.":
    "Ez a javaslat már nem rögzíthető. Töltsd újra, hogy lásd a jelenlegi állapotot.",
  "This option is already locked. Reload to see the current decision.":
    "Ez a javaslat már rögzítve van. Töltsd újra, hogy lásd a jelenlegi döntést.",
  "This option is locked. Unlock it before editing.":
    "Ez a javaslat rögzítve van. Szerkesztés előtt oldd fel.",
  "This option is priced for the whole trip, so everyone is already in.":
    "Ennek a javaslatnak az ára az egész csapatra szól, tehát mindenki benne van.",
  "This option isn't locked as you last saw it. Reload to see the current state.":
    "Ez a javaslat nem úgy van rögzítve, ahogy utoljára láttad. Töltsd újra a jelenlegi állapothoz.",
  "This option was changed since you opened it. Reload to see the latest.":
    "Ez a javaslat megváltozott, mióta megnyitottad. Töltsd újra a legfrissebb állapothoz.",
  "This trip has ended and can no longer be changed.":
    "Ez az utazás véget ért, már nem módosítható.",
  "This trip has ended and is no longer accepting new members.":
    "Ez az utazás véget ért, már nem fogad új tagokat.",
  "This trip is full.": "Ez az utazás megtelt.",
  "This trip was changed since you opened it. Reload to see the latest.":
    "Ez az utazás megváltozott, mióta megnyitottad. Töltsd újra a legfrissebb állapothoz.",
  "Trip not found": "Az utazás nem található",
  "Verify your email address before accepting a co-organizer invite.":
    "Erősítsd meg az e-mail-címedet, mielőtt elfogadsz egy társszervezői meghívást.",
  "You already own this trip.": "Ez az utazás már a tiéd.",
  "You can only assign a role below your own.":
    "Csak a sajátodnál alacsonyabb szerepet adhatsz.",
  "You can only block members below your own role.":
    "Csak a sajátodnál alacsonyabb szerepű tagokat tilthatod ki.",
  "You can only invite people to a role below your own.":
    "Csak a sajátodnál alacsonyabb szerepbe hívhatsz meg valakit.",
  "You can only manage members below your own role.":
    "Csak a sajátodnál alacsonyabb szerepű tagokat kezelheted.",
  "You can only remove members below your own role.":
    "Csak a sajátodnál alacsonyabb szerepű tagokat távolíthatod el.",
  "You can't delete this message": "Ezt az üzenetet nem törölheted",
  "You can't delete your own account from here.":
    "Innen nem törölheted a saját fiókodat.",
  "You can't suspend your own account.":
    "A saját fiókodat nem függesztheted fel.",
  "You don't have permission to do this.": "Ehhez nincs jogosultságod.",
  "Your account has been suspended. Reason: {reason}":
    "A fiókodat felfüggesztettük. Indok: {reason}",
  "Your account is suspended until {date}. Reason: {reason}":
    "A fiókod {date} napjáig fel van függesztve. Indok: {reason}",
  "You've been removed from this trip and can't rejoin.":
    "Eltávolítottak erről az utazásról, nem tudsz újra csatlakozni.",
  // "database unreachable" is deliberately absent, which leaves it English: it is
  // the health endpoint's own wording, and an operator reading a probe response is
  // better served by the string every other monitoring tool prints. An untranslated
  // entry is a decision here, not an omission — the fallback is the source language.
  "“{name}” has {locked} decided options. Unlock all but one before making it single-choice.":
    "A „{name}” sávban {locked} eldöntött javaslat van. Egy kivételével oldd fel őket, hogy egyválasztós legyen.",
  "“{name}” is full at {cap} options. Remove one to propose another.":
    "A „{name}” sáv megtelt, {cap} javaslat van benne. Törölj egyet, ha újat szeretnél.",
};

/** Hungarian for the four emails. Whole sentences, placeholders where values go. */
export const HU_EMAIL_MESSAGES: Readonly<Record<string, string>> = {
  "Open the invite": "Meghívó megnyitása",
  "Open the trip": "Utazás megnyitása",
  "Someone tried to register with this email. If it was you, just log in — no new account was created.":
    "Valaki regisztrálni próbált ezzel az e-mail-címmel. Ha te voltál, egyszerűen jelentkezz be — új fiók nem jött létre.",
  Unsubscribe: "Leiratkozás",
  "Verify my email": "E-mail-cím megerősítése",
  "Verify your email": "Erősítsd meg az e-mail-címedet",
  "Welcome to Group Trip Planner. Confirm your email:":
    "Üdv a Group Trip Plannerben! Erősítsd meg az e-mail-címedet:",
  "You already have an account": "Már van fiókod",
  "You get this because mention email is on.":
    "Ezt azért kaptad, mert be van kapcsolva a megemlítési értesítő.",
  'You\'re invited to "{trip}"': "Meghívtak: „{trip}”",
  'You\'ve been invited to join "{trip}" on Group Trip Planner.':
    "Meghívtak a „{trip}” utazásra a Group Trip Plannerben.",
  "it only turns off notification email, never account email.":
    "ez csak az értesítő leveleket kapcsolja ki, a fiókkal kapcsolatosakat soha.",
  '{name} mentioned you in "{trip}"': "{name} megemlített itt: „{trip}”",
  '{name} mentioned you in "{trip}":': "{name} megemlített itt: „{trip}”:",
};
