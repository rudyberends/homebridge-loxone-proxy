/**
 * Pure SDP helpers extracted from LoxoneTalkbackSession.
 *
 * Loxone intercoms can reject a WebRTC answer whose media (m=) sections are not
 * in the same order as the offer. These functions reorder an answer's media
 * sections to match the offer (by mid, by media type, then by brute-force
 * permutation) and describe an SDP's m-line order for logging. They are pure
 * string transformations so they can be unit-tested without a peer connection.
 */

export interface SdpParts {
  session: string;
  mediaSections: string[];
  lineEnding: '\r\n' | '\n';
}

export function buildReorderedAnswerCandidates(offerSdp: string, answerSdp: string): string[] {
  const offerParts = splitSdpSections(offerSdp);
  const answerParts = splitSdpSections(answerSdp);
  if (!offerParts || !answerParts) {
    return [];
  }

  const { mediaSections: offerSections } = offerParts;
  const { mediaSections: answerSections } = answerParts;

  if (offerSections.length !== answerSections.length) {
    return [];
  }

  const candidates: string[] = [];

  const byMid = reorderSectionsByMid(offerSections, answerSections);
  if (byMid) {
    candidates.push(composeSdpWithOrderedSections(answerParts, byMid));
  }

  const byType = reorderSectionsByType(offerSections, answerSections);
  if (byType) {
    candidates.push(composeSdpWithOrderedSections(answerParts, byType));
  }

  const permutations = permuteSections(answerSections);
  for (const permutation of permutations) {
    candidates.push(composeSdpWithOrderedSections(answerParts, permutation));
  }

  return [...new Set(candidates)];
}

export function splitSdpSections(sdp: string): SdpParts | undefined {
  if (!sdp.includes('m=')) {
    return undefined;
  }

  const lineEnding: '\r\n' | '\n' = sdp.includes('\r\n') ? '\r\n' : '\n';
  const normalized = sdp.replace(/\r\n/g, '\n');
  const chunks = normalized.split('\nm=');
  if (chunks.length < 2) {
    return undefined;
  }

  const session = `${chunks[0]}\n`;
  const mediaSections = chunks.slice(1).map((chunk) => `m=${chunk}`);
  return {
    session,
    mediaSections: mediaSections.map((section) => section.replace(/\n/g, lineEnding)),
    lineEnding,
  };
}

export function getSdpMediaType(section: string): string | undefined {
  const firstLine = section.split(/\r?\n/, 1)[0];
  const match = /^m=([^\s]+)/.exec(firstLine);
  return match?.[1];
}

export function getSdpMid(section: string): string | undefined {
  const match = section.match(/^a=mid:([^\r\n]+)/m);
  return match?.[1];
}

function reorderSectionsByMid(offerSections: string[], answerSections: string[]): string[] | undefined {
  const answerByMid = new Map<string, string>();
  for (const section of answerSections) {
    const mid = getSdpMid(section);
    if (mid) {
      answerByMid.set(mid, section);
    }
  }

  const ordered: string[] = [];
  for (const offerSection of offerSections) {
    const offerMid = getSdpMid(offerSection);
    if (!offerMid) {
      return undefined;
    }

    const section = answerByMid.get(offerMid);
    if (!section) {
      return undefined;
    }
    ordered.push(section);
  }

  return ordered;
}

function reorderSectionsByType(offerSections: string[], answerSections: string[]): string[] | undefined {
  const availableByType = new Map<string, string[]>();

  for (const section of answerSections) {
    const mediaType = getSdpMediaType(section);
    if (!mediaType) {
      continue;
    }
    const bucket = availableByType.get(mediaType) ?? [];
    bucket.push(section);
    availableByType.set(mediaType, bucket);
  }

  const ordered: string[] = [];
  for (const offerSection of offerSections) {
    const mediaType = getSdpMediaType(offerSection);
    if (!mediaType) {
      return undefined;
    }

    const bucket = availableByType.get(mediaType);
    const nextSection = bucket?.shift();
    if (!nextSection) {
      return undefined;
    }
    ordered.push(nextSection);
  }

  return ordered;
}

function composeSdpWithOrderedSections(parts: SdpParts, orderedSections: string[]): string {
  const withBundle = rewriteBundleLine(parts.session, orderedSections, parts.lineEnding);
  return `${withBundle}${orderedSections.join('')}`;
}

function rewriteBundleLine(session: string, orderedSections: string[], lineEnding: '\r\n' | '\n'): string {
  const mids = orderedSections
    .map((section) => getSdpMid(section))
    .filter((value): value is string => !!value);
  if (!mids.length) {
    return session;
  }

  const normalized = session.replace(/\r\n/g, '\n');
  const replaced = normalized.replace(/^a=group:BUNDLE[^\n]*$/m, `a=group:BUNDLE ${mids.join(' ')}`);
  return replaced.replace(/\n/g, lineEnding);
}

export function permuteSections(sections: string[]): string[][] {
  if (sections.length <= 1) {
    return [sections.slice()];
  }

  // Avoid combinatorial explosion; typical SDP media sections are <= 3.
  if (sections.length > 4) {
    return [];
  }

  const results: string[][] = [];
  const used = new Array<boolean>(sections.length).fill(false);
  const current: string[] = [];

  const dfs = (): void => {
    if (current.length === sections.length) {
      results.push(current.slice());
      return;
    }

    for (let i = 0; i < sections.length; i++) {
      if (used[i]) {
        continue;
      }
      used[i] = true;
      current.push(sections[i]);
      dfs();
      current.pop();
      used[i] = false;
    }
  };

  dfs();
  return results;
}

export function describeSdpMlineOrder(sdp: string): string {
  const parts = splitSdpSections(sdp);
  if (!parts) {
    return 'none';
  }

  return parts.mediaSections
    .map((section) => {
      const type = getSdpMediaType(section) ?? '?';
      const mid = getSdpMid(section) ?? '?';
      return `${type}:${mid}`;
    })
    .join(',');
}
