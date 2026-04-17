import type { Cluster } from "../types";

interface ClusterCardProps {
  cluster: Cluster;
  onGeneratePack: (cluster: Cluster) => void;
}

export default function ClusterCard({ cluster, onGeneratePack }: ClusterCardProps) {
  const updatedAt = new Date(cluster.updated_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className="surface-card-sheen rounded-[16px] px-4 py-3.5"
      style={{ position: "relative", overflow: "hidden" }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at top left, rgba(129,140,248,0.12) 0%, transparent 32%)",
        }}
      />

      <div className="relative flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
          style={{
            background: "var(--accent-muted)",
            color: "var(--accent-hover)",
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          ≡
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className="truncate"
                style={{ fontSize: 14, color: "var(--text-1)", fontWeight: 650 }}
              >
                {cluster.title}
              </p>
              <div
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5"
                style={{ fontSize: 10, color: "var(--text-3)" }}
              >
                <span>{cluster.item_ids.length} capture{cluster.item_ids.length === 1 ? "" : "s"}</span>
                <span>Updated {updatedAt}</span>
              </div>
            </div>

            <button
              onClick={() => onGeneratePack(cluster)}
              className="shrink-0 rounded-full px-3 py-1.5 transition-opacity hover:opacity-85"
              style={{
                background: "var(--accent-muted)",
                color: "var(--accent-hover)",
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              Generate pack
            </button>
          </div>

          <p style={{ marginTop: 10, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
            A reusable cluster for faster retrieval when related signals keep stacking up.
          </p>
        </div>
      </div>
    </div>
  );
}
