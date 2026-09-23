#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TeamsCaption {
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TeamsCaptionSnapshot {
    pub context_id: Option<String>,
    pub captions: Vec<TeamsCaption>,
    pub status: String,
}

/// Read-only: never enables captions, changes Teams settings, or prompts for AX access.
pub fn capture_teams_captions() -> TeamsCaptionSnapshot {
    #[cfg(target_os = "macos")]
    {
        use super::*;
        let empty = |status: &str| TeamsCaptionSnapshot {
            status: status.into(),
            ..Default::default()
        };
        if !macos_accessibility_client::accessibility::application_is_trusted() {
            return empty("accessibility_required");
        }
        let apps: Vec<_> = running_meeting_apps()
            .into_iter()
            .filter(|(app, _)| {
                matches!(
                    app.id.as_str(),
                    "com.microsoft.teams2" | "com.microsoft.teams"
                )
            })
            .collect();
        if apps.len() != 1 {
            return empty("no_unique_teams_app");
        }
        let (app, pid) = &apps[0];
        let ax_app = ax::UiElement::with_app_pid(*pid);
        let _ = ax_app.set_messaging_timeout_secs(0.2);
        let mut warnings = Vec::new();
        let roots = collect_native_meeting_windows(
            &ax_app,
            &MeetingPlatform::MicrosoftTeams,
            true,
            &mut warnings,
        );
        // An incomplete second window must not make the first appear unambiguous.
        if roots.len() != 1 || !warnings.is_empty() {
            return empty("no_unique_complete_meeting");
        }
        let (root, _) = &roots[0];
        let Some(window) = root.nodes.first().and_then(|node| node.element_hash) else {
            return empty("no_stable_window");
        };
        match parse_captions(&root.nodes) {
            Some(captions) => TeamsCaptionSnapshot {
                context_id: Some(format!("{}:{pid}:{window}", app.id)),
                status: if captions.is_empty() {
                    "waiting_for_captions"
                } else {
                    "capturing"
                }
                .into(),
                captions,
            },
            None => empty("captions_off_or_unsupported_layout"),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        TeamsCaptionSnapshot {
            status: "macos_only".into(),
            ..Default::default()
        }
    }
}

#[cfg(any(test, target_os = "macos"))]
pub(super) fn needs_caption_bounds(
    identifier: Option<&str>,
    title: Option<&str>,
    description: Option<&str>,
    value: Option<&str>,
) -> bool {
    matches!(
        identifier,
        Some(
            "closed-captions-container"
                | "closed-captions-renderer"
                | "live-captions"
                | "closed-caption-item"
                | "caption-item"
                | "closed-caption-speaker-name"
                | "speaker-name"
                | "author"
                | "closed-caption-text"
                | "caption-text"
        )
    ) || [title, description, value]
        .into_iter()
        .flatten()
        .any(|label| label.trim().eq_ignore_ascii_case("live captions"))
}

#[cfg(any(test, target_os = "macos"))]
fn parse_captions(nodes: &[super::AxNode]) -> Option<Vec<TeamsCaption>> {
    use super::{node_has_positive_bounds, node_labels, path_is_ancestor};
    let id_is = |node: &super::AxNode, values: &[&str]| {
        node.identifier
            .as_deref()
            .is_some_and(|id| values.contains(&id))
    };
    let scopes: Vec<_> = nodes
        .iter()
        .filter(|node| {
            matches!(
                node.role.as_deref(),
                Some("AXGroup" | "AXScrollArea" | "AXList")
            ) && node_has_positive_bounds(node)
                && (id_is(
                    node,
                    &[
                        "closed-captions-container",
                        "closed-captions-renderer",
                        "live-captions",
                    ],
                ) || node_labels(node)
                    .any(|label| label.trim().eq_ignore_ascii_case("live captions")))
        })
        .collect();
    // Require one explicitly labeled caption region. Never interpret chat/roster text as captions.
    let [scope] = scopes.as_slice() else {
        return None;
    };
    let rows: Vec<_> = nodes
        .iter()
        .filter(|node| {
            path_is_ancestor(&scope.tree_path, &node.tree_path)
                && id_is(node, &["closed-caption-item", "caption-item"])
                && node_has_positive_bounds(node)
        })
        .collect();
    if rows.len() > 16 {
        return None;
    }
    let mut captions = Vec::new();
    for row in rows {
        let field = |ids: &[&str]| -> Option<String> {
            let fields: Vec<_> = nodes
                .iter()
                .filter(|node| {
                    path_is_ancestor(&row.tree_path, &node.tree_path)
                        && node_has_positive_bounds(node)
                        && !node.settable_value
                        && !super::node::is_text_input_role(&node.role)
                        && id_is(node, ids)
                })
                .collect();
            let [node] = fields.as_slice() else {
                return None;
            };
            let value = node.value.as_deref().or(node.title.as_deref())?.trim();
            (!value.is_empty()).then(|| value.to_owned())
        };
        let speaker = field(&["closed-caption-speaker-name", "speaker-name", "author"])?;
        let text = field(&["closed-caption-text", "caption-text"])?;
        if speaker.chars().count() > 120
            || text.chars().count() > 2_000
            || speaker.chars().any(char::is_control)
            || matches!(
                speaker.to_lowercase().as_str(),
                "speaker" | "unknown speaker" | "anonymous" | "you"
            )
            || speaker.to_lowercase().starts_with("speaker ")
        {
            continue;
        }
        captions.push(TeamsCaption { speaker, text });
    }
    Some(captions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meeting_ax::{AxNode, AxRect};
    fn node(path: &[usize], id: &str, text: &str) -> AxNode {
        AxNode {
            index: 0,
            tree_path: path.into(),
            element_hash: Some(1),
            role: Some("AXGroup".into()),
            identifier: Some(id.into()),
            title: Some(text.into()),
            value: None,
            description: None,
            placeholder: None,
            enabled: Some(true),
            settable_value: false,
            bounds: Some(AxRect {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 20.0,
            }),
            text: text.into(),
            within_zoom_meeting_scope: false,
            within_zoom_chat_scope: false,
            within_slack_huddle_scope: false,
        }
    }
    fn fixture() -> Vec<AxNode> {
        vec![
            node(&[0], "live-captions", "Live captions"),
            node(&[0, 0], "closed-caption-item", ""),
            node(&[0, 0, 0], "speaker-name", "Alex Example"),
            node(
                &[0, 0, 1],
                "closed-caption-text",
                "We should review the example tomorrow.",
            ),
        ]
    }
    #[test]
    fn reads_only_explicit_caption_fields() {
        let mut nodes = fixture();
        nodes.push(node(&[1, 0], "closed-caption-text", "unrelated chat"));
        let result = parse_captions(&nodes).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].speaker, "Alex Example");
        assert!(!result[0].text.contains("unrelated"));
    }
    #[test]
    fn rejects_missing_or_ambiguous_fields() {
        let mut nodes = fixture();
        nodes.pop();
        assert!(parse_captions(&nodes).is_none());
        let mut nodes = fixture();
        nodes.push(node(&[0, 0, 2], "speaker-name", "Other"));
        assert!(parse_captions(&nodes).is_none());
    }
    #[test]
    fn rejects_multiple_regions_and_unknown_layouts() {
        assert!(parse_captions(&[node(&[0], "chat", "Chat")]).is_none());
        let mut nodes = fixture();
        nodes.push(node(&[1], "live-captions", "Live captions"));
        assert!(parse_captions(&nodes).is_none());
    }
    #[test]
    fn respects_hidden_identity() {
        let mut nodes = fixture();
        nodes[2].title = Some("Speaker 1".into());
        assert!(parse_captions(&nodes).unwrap().is_empty());
    }

    #[test]
    fn snapshot_collects_bounds_for_every_caption_field() {
        for node in fixture() {
            assert!(needs_caption_bounds(
                node.identifier.as_deref(),
                node.title.as_deref(),
                node.description.as_deref(),
                node.value.as_deref(),
            ));
        }
        assert!(!needs_caption_bounds(Some("unrelated"), None, None, None));
    }

    #[test]
    fn hidden_or_editable_fields_are_not_caption_evidence() {
        let mut nodes = fixture();
        nodes[2].bounds = None;
        assert!(parse_captions(&nodes).is_none());
        let mut nodes = fixture();
        nodes[3].role = Some("AXTextField".into());
        assert!(parse_captions(&nodes).is_none());
    }
}
