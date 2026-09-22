import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/**
 * 내 알림 목록 (헤더 종 아이콘 30초 폴링용).
 * since 가 있으면 그 id 이후 델타만 온다. unread_count / latest_id 는 항상 전체 기준.
 */
export const getNotifications = ({ since, limit = 50, unreadOnly = false } = {}) =>
  axios.get(`${API_BASE_URL}/api/notifications`, {
    params: {
      ...(since != null ? { since } : {}),
      limit,
      unread_only: unreadOnly,
    },
    headers: getAuthHeaders(),
  });

/** 알림 1건 읽음 처리(멱등) */
export const markNotificationRead = (id) =>
  axios.post(`${API_BASE_URL}/api/notifications/${id}/read`, {}, { headers: getAuthHeaders() });

/** 내 미읽음 전부 읽음 처리 */
export const markAllNotificationsRead = () =>
  axios.post(`${API_BASE_URL}/api/notifications/read-all`, {}, { headers: getAuthHeaders() });

/** 알림 1건 삭제(내 것만) */
export const deleteNotification = (id) =>
  axios.delete(`${API_BASE_URL}/api/notifications/${id}`, { headers: getAuthHeaders() });
