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
      <div className="flex-1 flex items-center justify-center">
        <p style={{ fontSize: "var(--text-metadata, 11px)", color: "var(--text-3, var(--text-2))" }}>
          Loading topics...
        </p>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p
          style={{
            fontSize: "var(--text-body, 13px)",
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}
        >
          Topics appear when AI groups 3+ related captures.
        </p>
        <p
          style={{
            fontSize: "var(--text-metadata, 11px)",
            color: "var(--text-3, var(--text-2))",
            marginTop: 6,
          }}
        >
          Keep capturing – patterns emerge over time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "var(--well-floor)" }}>
      <div className="px-3 py-2 space-y-2">
        {clusters.map((cluster) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            onGeneratePack={handleGeneratePack}
          />
        ))}
      </div>
    </div>
  );
}
