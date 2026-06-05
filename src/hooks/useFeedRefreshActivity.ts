import { useEffect, useState } from "react";
import {
  feedRefreshActivityBus,
  type FeedRefreshActivity,
} from "../services/feeds/feedRefreshActivity";

export function useFeedRefreshActivity(feedId?: string): FeedRefreshActivity[] {
  const [activities, setActivities] = useState<FeedRefreshActivity[]>(() =>
    filterActivities(feedRefreshActivityBus.getAll(), feedId),
  );

  useEffect(() => {
    setActivities(filterActivities(feedRefreshActivityBus.getAll(), feedId));
    return feedRefreshActivityBus.subscribe(() => {
      setActivities(filterActivities(feedRefreshActivityBus.getAll(), feedId));
    });
  }, [feedId]);

  return activities;
}

function filterActivities(
  activities: FeedRefreshActivity[],
  feedId?: string,
): FeedRefreshActivity[] {
  return feedId ? activities.filter((activity) => activity.feedId === feedId) : activities;
}
