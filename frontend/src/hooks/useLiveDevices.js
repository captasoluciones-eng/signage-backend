import { useEffect, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Realtime subscription to the `devices` collection via the Firebase JS SDK,
 * per the "live status updates" requirement. Firestore security rules
 * (infra/firestore.rules) restrict this to signed-in, allow-listed admin
 * emails -- the same accounts that can reach the REST admin API.
 *
 * Returns a map keyed by deviceId so pages can cheaply merge live fields
 * (online, lastSeen, itemActual) onto the paginated REST result without
 * refetching the whole table on every snapshot.
 */
export function useLiveDevices() {
  const [liveById, setLiveById] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "devices"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const next = {};
        snapshot.forEach((doc) => {
          next[doc.id] = { deviceId: doc.id, ...doc.data() };
        });
        setLiveById(next);
      },
      (err) => setError(err)
    );
    return unsub;
  }, []);

  return { liveById, error };
}
