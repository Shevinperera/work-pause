// Verse of the day for the sign-in page.
// - King James Version (public domain).
// - Rotates at midnight Asia/Colombo; everyone sees the same verse that day.
// - Pure selection logic is exported so it can be unit-tested in Node; DOM
//   rendering only runs in the browser.

export const TRANSLATION = 'King James Version';
export const TIMEZONE = 'Asia/Colombo';

// Some entries are the opening clause of a longer verse; the final punctuation
// is normalised to a full stop for display.
export const VERSES = [
  { ref: 'Colossians 3:23', text: 'And whatsoever ye do, do it heartily, as to the Lord, and not unto men.' },
  { ref: 'Psalm 118:24', text: 'This is the day which the LORD hath made; we will rejoice and be glad in it.' },
  { ref: 'Proverbs 16:3', text: 'Commit thy works unto the LORD, and thy thoughts shall be established.' },
  { ref: 'Isaiah 40:31', text: 'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint.' },
  { ref: 'Philippians 4:13', text: 'I can do all things through Christ which strengtheneth me.' },
  { ref: 'Matthew 11:28', text: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.' },
  { ref: 'Proverbs 3:5–6', text: 'Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.' },
  { ref: 'Galatians 6:9', text: 'And let us not be weary in well doing: for in due season we shall reap, if we faint not.' },
  { ref: 'Lamentations 3:22–23', text: "It is of the LORD's mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness." },
  { ref: 'Joshua 1:9', text: 'Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.' },
  { ref: 'Ecclesiastes 9:10', text: 'Whatsoever thy hand findeth to do, do it with thy might.' },
  { ref: 'Psalm 90:17', text: 'And let the beauty of the LORD our God be upon us: and establish thou the work of our hands upon us; yea, the work of our hands establish thou it.' },
  { ref: 'Philippians 4:6', text: 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.' },
  { ref: 'Proverbs 14:23', text: 'In all labour there is profit: but the talk of the lips tendeth only to penury.' },
  { ref: 'Jeremiah 29:11', text: 'For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.' },
  { ref: 'Psalm 46:10', text: 'Be still, and know that I am God.' },
  { ref: '1 Corinthians 15:58', text: 'Therefore, my beloved brethren, be ye stedfast, unmoveable, always abounding in the work of the Lord, forasmuch as ye know that your labour is not in vain in the Lord.' },
  { ref: 'Philippians 4:7', text: 'And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.' },
  { ref: 'Proverbs 22:29', text: 'Seest thou a man diligent in his business? he shall stand before kings; he shall not stand before mean men.' },
  { ref: 'Romans 8:28', text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.' },
  { ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' },
  { ref: 'Isaiah 41:10', text: 'Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.' },
  { ref: 'Matthew 5:16', text: 'Let your light so shine before men, that they may see your good works, and glorify your Father which is in heaven.' },
  { ref: 'Micah 6:8', text: 'He hath shewed thee, O man, what is good; and what doth the LORD require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?' },
  { ref: 'Psalm 37:5', text: 'Commit thy way unto the LORD; trust also in him; and he shall bring it to pass.' },
  { ref: '2 Timothy 1:7', text: 'For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.' },
  { ref: 'Psalm 121:1–2', text: 'I will lift up mine eyes unto the hills, from whence cometh my help. My help cometh from the LORD, which made heaven and earth.' },
  { ref: 'Psalm 119:105', text: 'Thy word is a lamp unto my feet, and a light unto my path.' },
  { ref: 'Matthew 6:34', text: 'Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself. Sufficient unto the day is the evil thereof.' },
  { ref: 'John 14:27', text: 'Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid.' },
  { ref: 'Proverbs 12:24', text: 'The hand of the diligent shall bear rule: but the slothful shall be under tribute.' },
  { ref: '1 Thessalonians 5:16–18', text: 'Rejoice evermore. Pray without ceasing. In every thing give thanks: for this is the will of God in Christ Jesus concerning you.' },
  { ref: 'Proverbs 16:9', text: "A man's heart deviseth his way: but the LORD directeth his steps." },
  { ref: 'Psalm 55:22', text: 'Cast thy burden upon the LORD, and he shall sustain thee: he shall never suffer the righteous to be moved.' },
  { ref: '1 Peter 5:7', text: 'Casting all your care upon him; for he careth for you.' },
  { ref: 'Proverbs 27:17', text: 'Iron sharpeneth iron; so a man sharpeneth the countenance of his friend.' },
  { ref: 'Ecclesiastes 4:9', text: 'Two are better than one; because they have a good reward for their labour.' },
  { ref: 'Colossians 3:17', text: 'And whatsoever ye do in word or deed, do all in the name of the Lord Jesus, giving thanks to God and the Father by him.' },
  { ref: 'Ephesians 4:32', text: "And be ye kind one to another, tenderhearted, forgiving one another, even as God for Christ's sake hath forgiven you." },
  { ref: 'Psalm 34:8', text: 'O taste and see that the LORD is good: blessed is the man that trusteth in him.' },
  { ref: 'Proverbs 15:1', text: 'A soft answer turneth away wrath: but grievous words stir up anger.' },
  { ref: 'James 1:5', text: 'If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.' },
  { ref: 'Matthew 7:7', text: 'Ask, and it shall be given you; seek, and ye shall find; knock, and it shall be opened unto you.' },
  { ref: 'Romans 15:13', text: 'Now the God of hope fill you with all joy and peace in believing, that ye may abound in hope, through the power of the Holy Ghost.' },
  { ref: 'Numbers 6:24–26', text: 'The LORD bless thee, and keep thee: The LORD make his face shine upon thee, and be gracious unto thee: The LORD lift up his countenance upon thee, and give thee peace.' },
  { ref: 'Psalm 19:14', text: 'Let the words of my mouth, and the meditation of my heart, be acceptable in thy sight, O LORD, my strength, and my redeemer.' },
  { ref: '2 Corinthians 5:7', text: 'For we walk by faith, not by sight.' },
  { ref: 'Hebrews 11:1', text: 'Now faith is the substance of things hoped for, the evidence of things not seen.' },
  { ref: 'Proverbs 4:23', text: 'Keep thy heart with all diligence; for out of it are the issues of life.' },
  { ref: 'Deuteronomy 31:6', text: 'Be strong and of a good courage, fear not, nor be afraid of them: for the LORD thy God, he it is that doth go with thee; he will not fail thee, nor forsake thee.' },
  { ref: 'Psalm 16:8', text: 'I have set the LORD always before me: because he is at my right hand, I shall not be moved.' },
  { ref: 'Romans 12:11', text: 'Not slothful in business; fervent in spirit; serving the Lord.' },
  { ref: '1 Corinthians 16:14', text: 'Let all your things be done with charity.' },
  { ref: 'Ecclesiastes 3:1', text: 'To every thing there is a season, and a time to every purpose under the heaven.' },
  { ref: 'Psalm 4:8', text: 'I will both lay me down in peace, and sleep: for thou, LORD, only makest me dwell in safety.' },
  { ref: 'John 13:34', text: 'A new commandment I give unto you, That ye love one another; as I have loved you, that ye also love one another.' },
  { ref: 'Psalm 145:18', text: 'The LORD is nigh unto all them that call upon him, to all that call upon him in truth.' },
  { ref: 'Matthew 5:9', text: 'Blessed are the peacemakers: for they shall be called the children of God.' },
  { ref: 'Proverbs 10:4', text: 'He becometh poor that dealeth with a slack hand: but the hand of the diligent maketh rich.' },
  { ref: '2 Thessalonians 3:13', text: 'But ye, brethren, be not weary in well doing.' },
  { ref: 'Isaiah 26:3', text: 'Thou wilt keep him in perfect peace, whose mind is stayed on thee: because he trusteth in thee.' },
  { ref: 'Psalm 37:4', text: 'Delight thyself also in the LORD; and he shall give thee the desires of thine heart.' },
  { ref: 'Romans 12:12', text: 'Rejoicing in hope; patient in tribulation; continuing instant in prayer.' },
  { ref: 'Galatians 5:22–23', text: 'But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith, meekness, temperance: against such there is no law.' },
];

const dateKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' for an instant, in Asia/Colombo. */
export function colomboDateKey(ms = Date.now()) {
  return dateKeyFmt.format(new Date(ms));
}

/** Whole days since 1970-01-01 for a 'YYYY-MM-DD' key (timezone independent). */
export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** The verse for a calendar day. Cycles through every verse before repeating. */
export function verseForDate(key) {
  const n = VERSES.length;
  return VERSES[((dayNumber(key) % n) + n) % n];
}

/** Length bucket so long verses get a smaller type size. */
export function verseSize(text) {
  if (text.length <= 70) return 'short';
  if (text.length <= 140) return 'medium';
  return 'long';
}

// ---- Browser rendering -----------------------------------------------------
function render(root, key) {
  const v = verseForDate(key);
  const text = root.querySelector('[data-verse-text]');
  const ref = root.querySelector('[data-verse-ref]');
  if (!text || !ref) return;
  if (root.dataset.verseDate === key) return;
  root.dataset.verseDate = key;
  root.dataset.size = verseSize(v.text);
  text.textContent = v.text;
  ref.textContent = v.ref;
  // Restart the entrance animation for the new verse.
  root.classList.remove('is-fresh');
  void root.offsetWidth;
  root.classList.add('is-fresh');
}

if (typeof document !== 'undefined') {
  const update = () => {
    const key = colomboDateKey();
    document.querySelectorAll('[data-daily-verse]').forEach((el) => render(el, key));
  };
  update();
  // Pick up the next day's verse if the page is left open past midnight.
  setInterval(update, 60 * 1000);
}

