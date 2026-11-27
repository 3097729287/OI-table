import { localizedLabels, t } from "../../i18n";
import { collectionName, type PersonalCollection } from "../../shared/personalCollections";
import type { WorkspaceTarget } from "../../workspace/layout";

export const allFavoritesTarget: WorkspaceTarget = { id: "favorites", params: {} };

export function favoriteGroupTarget(collection: PersonalCollection): WorkspaceTarget {
  return {
    id: "favorites",
    params: { groupId: collection.id },
    label: localizedLabels((locale) => collectionName(collection, t("favoriteDefault", undefined, locale))),
  };
}
