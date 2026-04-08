import { useStore } from "../lib/store";

export default function Toast() {
  const { toast } = useStore();
  if (!toast.visible) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-gray-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium max-w-[340px] truncate">
        {toast.message}
      </div>
    </div>
  );
}
