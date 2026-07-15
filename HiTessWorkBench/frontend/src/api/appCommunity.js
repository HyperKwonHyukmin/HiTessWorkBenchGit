import axios from 'axios';

import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

const appPath = (appKey) =>
  `${API_BASE_URL}/api/apps/${encodeURIComponent(appKey)}`;

export const getAppCommunity = (appKey) =>
  axios.get(`${appPath(appKey)}/community`, { headers: getAuthHeaders() });

export const getAppNotices = (appKey) =>
  axios.get(`${appPath(appKey)}/notices`, {
    params: { include_global: false },
    headers: getAuthHeaders(),
  });

export const getEntryNotices = (appKey) =>
  axios.get(`${appPath(appKey)}/entry-notices`, { headers: getAuthHeaders() });

export const acknowledgeEntryNotice = (appKey, noticeId) =>
  axios.post(
    `${appPath(appKey)}/notices/${noticeId}/acknowledge`,
    {},
    { headers: getAuthHeaders() },
  );

export const createAppNotice = (payload) =>
  axios.post(`${API_BASE_URL}/api/notices`, payload, { headers: getAuthHeaders() });

export const updateAppNotice = (noticeId, payload) =>
  axios.put(`${API_BASE_URL}/api/notices/${noticeId}`, payload, {
    headers: getAuthHeaders(),
  });

export const deleteAppNotice = (noticeId) =>
  axios.delete(`${API_BASE_URL}/api/notices/${noticeId}`, { headers: getAuthHeaders() });

export const getAppRequests = (appKey) =>
  axios.get(`${appPath(appKey)}/feature-requests`, { headers: getAuthHeaders() });

export const createAppRequest = (payload) =>
  axios.post(`${API_BASE_URL}/api/feature-requests`, payload, {
    headers: getAuthHeaders(),
  });

export const updateAppRequest = (requestId, payload) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${requestId}`, payload, {
    headers: getAuthHeaders(),
  });

export const deleteAppRequest = (requestId) =>
  axios.delete(`${API_BASE_URL}/api/feature-requests/${requestId}`, {
    headers: getAuthHeaders(),
  });

export const upvoteAppRequest = (requestId) =>
  axios.put(
    `${API_BASE_URL}/api/feature-requests/${requestId}/upvote`,
    {},
    { headers: getAuthHeaders() },
  );

export const replyToAppRequest = (requestId, payload) =>
  axios.put(`${API_BASE_URL}/api/feature-requests/${requestId}/comment`, payload, {
    headers: getAuthHeaders(),
  });
