/**
 * @gtp/api-client — shared, typed TanStack Query hooks over the REST API,
 * plus the fetch layer and QueryClient factory the three front-ends share.
 */
import { CONTRACT_VERSION } from "@gtp/types";

/** Version of the shared API client, pinned to the contract it targets. */
export const API_CLIENT_VERSION = CONTRACT_VERSION;

export {
  ApiError,
  apiFetch,
  setApiBaseUrl,
  getApiBaseUrl,
  setAccessToken,
  getAccessToken,
  refreshAccessToken,
} from "./http.js";
export type { ApiFetchInit } from "./http.js";
export { createQueryClient } from "./query.js";
export { useRegister, useLogin, useVerifyEmail } from "./auth.js";
export {
  tripKeys,
  useTrip,
  useTripPreview,
  useCreateTrip,
  useUpdateTrip,
  useDeleteTrip,
  useSetTripCover,
  useRemoveTripCover,
} from "./trips.js";
export {
  inviteKeys,
  useTripInvites,
  useCreateInvite,
  useDisableInvite,
  useJoinTrip,
} from "./invites.js";
export {
  memberKeys,
  useTripMembers,
  useChangeMemberRole,
  useKickMember,
  useBlockMember,
  useUnblockMember,
  useTransferOwnership,
  useLeaveTrip,
  useSetTripMute,
} from "./members.js";
export { activityKeys, useTripActivity } from "./activity.js";
export {
  accountKeys,
  useDeletionPreview,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useSetAvatar,
  useRemoveAvatar,
} from "./account.js";
export {
  categoryKeys,
  useTripCategories,
  useCreateCategory,
  useRenameCategory,
  useDeleteCategory,
  useReorderCategories,
} from "./categories.js";
export {
  optionKeys,
  useCategoryOptions,
  useCategoriesOptions,
  useProposeOption,
  useEditOption,
  useDeleteOption,
  useReorderOptions,
  useToggleVote,
  useLockOption,
  useUnlockOption,
  useBoardLock,
  useBoardUnlock,
  useBoardReorderOptions,
} from "./options.js";
export {
  dashboardKeys,
  useTripDashboard,
  useHomeDashboard,
} from "./dashboard.js";
export {
  notificationKeys,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationLiveSync,
} from "./notifications.js";
export { googleSignInUrl } from "./oauth.js";
export { AuthProvider, useAuth } from "./session.js";
export type { AuthContextValue, AuthStatus } from "./session.js";
export { useStartDiscussion } from "./channels.js";
export { useTripSocket, useChat, useBoardLiveSync } from "./socket.js";
export type {
  TripSocket,
  SocketStatus,
  ChatMessage,
  ChatController,
  LiveSocket,
} from "./socket.js";
