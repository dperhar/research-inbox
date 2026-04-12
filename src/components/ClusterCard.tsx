import type { Cluster } from "../types";

interface ClusterCardProps {
  cluster: Cluster;
  onGeneratePack: (cluster: Cluster) => void;
}

export default function ClusterCard({ cluster, onGeneratePack }: ClusterCardProps) {
  return (
    <div
      style={{
        background: "var(--surface-card, var(--well-floor))",
        borderRadius: 8,
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-card, 0 1px 3px rgba(0,0,0,0.08))",
        padding: "10px 12px",
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p
            className="font-medium truncate"
            style={{ fontSize: "var(--text-body, 13px)", color: "var(--text-1)" }}
          >
            {cluster.title}
          </p>
          <p
            style={{
              fontSize: "var(--text-metadata, 11px)",
              color: "var(--text-3, var(--text-2))",
              marginTop: 2,
            }}
          >
            {cluster.item_ids.length} {cluster.item_ids.length === 1 ? "capture" : "captures"}
          </p>
        </div>
        <button
          onClick={() => onGeneratePack(cluster)}
          className="shrink-0 px-2 py-1 rounded-md font-medium transition-colors hover:opacity-90"
          style={{
            fontSize: "var(--text-metadata, 11px)",
            background: "var(--accent)",
            color: "#fff",
            whiteSpace: "nowrap",
          }}
        >
          Generate pack
        </button>
      </div>
    </div>
  );
}
