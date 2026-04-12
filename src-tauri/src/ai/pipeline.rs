use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichmentResult {
    pub auto_tags: Vec<String>,
    pub content_class: String,
    pub entities: Vec<String>,
    pub summary: String,
}

/// Generate enrichment for captured content.
/// Currently uses heuristic rules. Will be replaced by LLM when sidecar is ready.
pub fn enrich_content(content: &str) -> EnrichmentResult {
    let lower = content.to_lowercase();

    // Simple heuristic classification
    let content_class = if lower.contains('?') {
        "question"
    } else if lower.contains("decided") || lower.contains("agreed") || lower.contains("will do") {
        "decision"
    } else if lower.contains('%') || lower.contains('$') || lower.contains("revenue") || lower.contains("churn") || lower.contains("mrr") {
        "data"
    } else if lower.starts_with('"') || lower.starts_with('\u{201c}') {
        "quote"
    } else {
        "reference"
    };

    // Extract basic entities (words that start with uppercase, >3 chars, not at sentence start)
    let entities: Vec<String> = content.split_whitespace()
        .filter(|w| w.len() > 3 && w.chars().next().map_or(false, |c| c.is_uppercase()))
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|w| !w.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .take(5)
        .collect();

    // Auto-tags from content keywords
    let mut auto_tags = Vec::new();
    let tag_keywords = [
        ("churn", "churn"), ("retention", "retention"), ("onboarding", "onboarding"),
        ("pricing", "pricing"), ("enterprise", "enterprise"), ("revenue", "revenue"),
        ("bug", "bug"), ("feature", "feature"), ("design", "design"),
        ("feedback", "feedback"), ("metric", "metrics"), ("customer", "customer"),
    ];
    for (keyword, tag) in &tag_keywords {
        if lower.contains(keyword) {
            auto_tags.push(format!("#{}", tag));
            if auto_tags.len() >= 3 { break; }
        }
    }

    // 1-line summary (first sentence, truncated)
    let summary = content.split(&['.', '!', '?', '\n'][..])
        .next()
        .unwrap_or(content)
        .chars()
        .take(80)
        .collect::<String>()
        .trim()
        .to_string();

    EnrichmentResult {
        auto_tags,
        content_class: content_class.to_string(),
        entities,
        summary,
    }
}

/// Generate a deterministic mock embedding from content.
/// Returns a 384-dim vector based on character frequencies.
/// Will be replaced by real LLM embeddings when sidecar is ready.
pub fn compute_mock_embedding(content: &str) -> Vec<f32> {
    let mut embedding = vec![0.0f32; 384];
    for (i, byte) in content.bytes().enumerate() {
        embedding[i % 384] += byte as f32 / 255.0;
    }
    // Normalize
    let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in &mut embedding {
            *v /= norm;
        }
    }
    embedding
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enrich_question() {
        let result = enrich_content("What is our churn rate this quarter?");
        assert_eq!(result.content_class, "question");
        assert!(result.auto_tags.contains(&"#churn".to_string()));
    }

    #[test]
    fn test_enrich_data() {
        let result = enrich_content("MRR dropped 15% due to enterprise churn");
        assert_eq!(result.content_class, "data");
    }

    #[test]
    fn test_enrich_quote() {
        let result = enrich_content("\"We need better onboarding\" - Customer A");
        assert_eq!(result.content_class, "quote");
        assert!(result.auto_tags.contains(&"#onboarding".to_string()));
    }

    #[test]
    fn test_mock_embedding_dimensions() {
        let emb = compute_mock_embedding("hello world");
        assert_eq!(emb.len(), 384);
    }

    #[test]
    fn test_mock_embedding_normalized() {
        let emb = compute_mock_embedding("test content for embedding");
        let norm: f32 = emb.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.01);
    }
}
