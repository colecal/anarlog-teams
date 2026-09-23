use std::collections::HashMap;

use crate::RenderedTranscriptSegment;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct TeamsCaptionObservation {
    pub observed_at_ms: i64,
    pub speaker: String,
    pub text: String,
}

fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Match exact phrases, not speaker clusters: one mistaken inference must not
/// relabel an entire meeting. Repeated phrases and overlapping names fail closed.
pub(super) fn labels(
    observations: &[TeamsCaptionObservation],
    segments: &[RenderedTranscriptSegment],
    started_at: i64,
) -> HashMap<(usize, usize), Option<String>> {
    let indexed: Vec<_> = segments
        .iter()
        .map(|segment| {
            segment
                .words
                .iter()
                .enumerate()
                .flat_map(|(index, word)| {
                    tokens(&word.text)
                        .into_iter()
                        .map(move |token| (token, index))
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let mut result = HashMap::new();
    for observation in observations.iter().take(10_000) {
        let name = observation.speaker.trim();
        let phrase = tokens(&observation.text);
        if name.is_empty()
            || name.chars().count() > 120
            || name.chars().any(char::is_control)
            || phrase.len() < 4
            || phrase.len() > 240
            || phrase.iter().map(String::len).sum::<usize>() < 18
        {
            continue;
        }
        let lower = observation.observed_at_ms.saturating_sub(20_000);
        let upper = observation.observed_at_ms.saturating_add(1_500);
        let mut matches = Vec::new();
        for (segment_index, segment) in segments.iter().enumerate() {
            if started_at.saturating_add(segment.end_ms) < lower
                || started_at.saturating_add(segment.start_ms) > upper
            {
                continue;
            }
            let stream = &indexed[segment_index];
            for (start, window) in stream.windows(phrase.len()).enumerate() {
                if !window
                    .iter()
                    .zip(&phrase)
                    .all(|((token, _), expected)| token == expected)
                {
                    continue;
                }
                let first = stream[start].1;
                let last = window.last().unwrap().1;
                let words = &segment.words[first..=last];
                if words.iter().all(|word| word.is_final)
                    && started_at.saturating_add(words[0].start_ms) >= lower
                    && started_at.saturating_add(words.last().unwrap().end_ms) <= upper
                    // A token boundary inside a multi-token word cannot label that whole word.
                    && (start == 0 || stream[start - 1].1 != first)
                    && (start + phrase.len() == stream.len() || stream[start + phrase.len()].1 != last)
                {
                    matches.push((segment_index, first, last));
                }
            }
        }
        let [(segment, first, last)] = matches.as_slice() else {
            continue;
        };
        for word in *first..=*last {
            result
                .entry((*segment, word))
                .and_modify(|existing: &mut Option<String>| {
                    if existing.as_deref() != Some(name) {
                        *existing = None;
                    }
                })
                .or_insert_with(|| Some(name.to_owned()));
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ChannelProfile, SegmentKey, SegmentWord};
    fn segment(text: &str, start: i64) -> RenderedTranscriptSegment {
        let words: Vec<_> = text
            .split_whitespace()
            .enumerate()
            .map(|(i, text)| SegmentWord {
                text: format!("{text} "),
                start_ms: start + i as i64 * 200,
                end_ms: start + i as i64 * 200 + 180,
                channel: ChannelProfile::RemoteParty,
                is_final: true,
                id: Some(i.to_string()),
            })
            .collect();
        RenderedTranscriptSegment {
            id: "s".into(),
            key: SegmentKey {
                channel: ChannelProfile::RemoteParty,
                speaker_index: Some(0),
                speaker_human_id: None,
            },
            speaker_label: "Speaker 1".into(),
            provisional_speaker: None,
            start_ms: start,
            end_ms: words.last().unwrap().end_ms,
            text: text.into(),
            words,
        }
    }
    fn observation(text: &str, name: &str) -> TeamsCaptionObservation {
        TeamsCaptionObservation {
            observed_at_ms: 12_000,
            speaker: name.into(),
            text: text.into(),
        }
    }
    const PHRASE: &str = "We should review the example tomorrow";
    #[test]
    fn tolerates_case_punctuation_and_caption_delay() {
        let segments = vec![segment(PHRASE, 1000)];
        let found = labels(
            &[observation(
                "WE should review the example, tomorrow!",
                "Alex",
            )],
            &segments,
            1000,
        );
        assert_eq!(found.len(), 6);
        assert!(found.values().all(|label| label.as_deref() == Some("Alex")));
    }
    #[test]
    fn rejects_short_repeated_stale_and_different_phrases() {
        let one = vec![segment(PHRASE, 1000)];
        assert!(labels(&[observation("yes okay", "Alex")], &one, 1000).is_empty());
        assert!(
            labels(
                &[observation("We must review the example tomorrow", "Alex")],
                &one,
                1000
            )
            .is_empty()
        );
        assert!(labels(&[observation(PHRASE, "Alex")], &one, 100_000).is_empty());
        assert!(
            labels(
                &[observation(PHRASE, "Alex")],
                &[one[0].clone(), segment(PHRASE, 3000)],
                1000
            )
            .is_empty()
        );
    }
    #[test]
    fn conflicts_cannot_be_overwritten_by_a_later_match() {
        let found = labels(
            &[
                observation(PHRASE, "Alex"),
                observation(PHRASE, "Sam"),
                observation(PHRASE, "Alex"),
            ],
            &[segment(PHRASE, 1000)],
            1000,
        );
        assert_eq!(found.len(), 6);
        assert!(found.values().all(Option::is_none));
    }
    #[test]
    fn only_labels_matched_words_and_never_partial_words() {
        let mut part = segment(&format!("Before this {PHRASE} after this"), 1000);
        let found = labels(&[observation(PHRASE, "Alex")], &[part.clone()], 1000);
        assert_eq!(found.len(), 6);
        assert!(!found.contains_key(&(0, 0)));
        part.words[3].is_final = false;
        assert!(labels(&[observation(PHRASE, "Alex")], &[part], 1000).is_empty());
    }
}
