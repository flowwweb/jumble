const normalize = (word) => {
  if (typeof word !== 'string' || !/^[a-z]{1,15}$/i.test(word.trim())) throw new TypeError('Override words require 1 to 15 ASCII letters.');
  return word.trim().toLowerCase();
};

/** This schema records review; it cannot establish that an invented spelling is English. */
export function applyDictionaryOverrides(words, overrides) {
  if (!overrides || typeof overrides !== 'object' || typeof overrides.revision !== 'string' || !/^[a-z0-9-]+$/.test(overrides.revision)
      || !Array.isArray(overrides.additions) || !Array.isArray(overrides.exclusions)) {
    throw new TypeError('Overrides require a revision and additions/exclusions arrays.');
  }
  const accepted = new Set(words.map(normalize));
  for (const addition of overrides.additions) {
    if (!addition || typeof addition !== 'object' || typeof addition.reason !== 'string' || !addition.reason.trim()
        || typeof addition.approvedBy !== 'string' || !addition.approvedBy.trim()
        || typeof addition.source !== 'string' || !/^https:\/\//.test(addition.source)) {
      throw new TypeError('Dictionary additions require source evidence, a reason, and an identified approving reviewer.');
    }
    accepted.add(normalize(addition.word));
  }
  for (const exclusion of overrides.exclusions) {
    if (!exclusion || typeof exclusion !== 'object' || typeof exclusion.reason !== 'string' || !exclusion.reason.trim()) {
      throw new TypeError('Dictionary exclusions require a reason.');
    }
    accepted.delete(normalize(exclusion.word));
  }
  return [...accepted].sort();
}
