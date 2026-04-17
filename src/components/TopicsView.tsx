import { useEffect, useState } from "react";
import { api } from "../lib/ipc";
import { useStore } from "../lib/store";
import type { Cluster } from "../types";
import ClusterCard from "./ClusterCard";

export default function TopicsView() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast, setEditingPack } = useStore();

  useEffect(() => {
    api.getClusters()
      .then(setClusters)
      .catch(() => setClusters([]))
      .finally(() => setLoading(false));
  }, []);

  const handleGeneratePack = async (cluster: Cluster) => {
    showToast("Generating pack...");
    try {
      const intent = `Create a context pack from the topic: ${cluster.title}`;
      const result = await api.generatePack(intent);
      const pack = await api.createPack(
        result.title,
        result.summary,
        null,
        null,
        result.item_ids,
        "markdown",
      );
      setEditingPack(pack);
    } catch (e: any) {
      showToast("Pack generation failed: " + (e?.toString() || "unknown error"));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="surface-card-quiet w-full rounded-[18px] px-5 py-6 text-center">
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
            Grouping related signals...
          </p>
        </div>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="surface-card-sheen w-full rounded-[18px] px-5 py-6 text-center">
          <p style={{ fontSize: 14, color: "var(--text-1)", fontWeight: 600 }}>
            No topic clusters yet.
          </p>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>
            Topics appear when AI notices patterns across 3 or more related captures.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto px-3 pb-3"
      style={{
        background:
          "linear-gradient(180deg, rgba(8,8,12,0.22) 0%, rgba(8,8,12,0.04) 100%), var(--well-glow)",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="px-1 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              fontWeight: 700,
            }}
          >
            Topics
          </span>
          <span
            className="rounded-full px-1.5 py-0.5"
            style={{
              fontSize: 10,
              color: "var(--text-2)",
              background: "rgba(255,255,255,0.04)",
            }}
          >
            {clusters.length}
          </span>
        </div>
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
          AI-generated clusters for retrieval when you do not know the exact keywords yet.
        </p>
      </div>

      <div className="space-y-2 px-1">
        {clusters.map((cluster, index) => (
          <div
            key={cluster.id}
            style={{
              animation: "itemStagger 220ms var(--ease-settle) both",
              animationDelay: `${Math.min(index, 6) * 22}ms`,
            }}
          >
            <ClusterCard cluster={cluster} onGeneratePack={handleGeneratePack} />
          </div>
        ))}
      </div>
    </div>
  );
}
