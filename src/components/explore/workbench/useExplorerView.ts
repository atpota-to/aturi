'use client';

import { useSyncExternalStore } from 'react';
import {
  getCollectionsDisplay,
  getCollectionsDisplayOnServer,
  getExplorerView,
  getExplorerViewOnServer,
  getFilesLayout,
  getFilesLayoutOnServer,
  subscribeExplorerView,
  type CollectionsDisplay,
  type ExplorerView,
  type FilesLayout,
} from '@/lib/explorerView';

/** The visitor's chosen layout for the account explorer. The default on the server. */
export function useExplorerView(): ExplorerView {
  return useSyncExternalStore(subscribeExplorerView, getExplorerView, getExplorerViewOnServer);
}

/** How the Files view draws a folder: icons or a list. */
export function useFilesLayout(): FilesLayout {
  return useSyncExternalStore(subscribeExplorerView, getFilesLayout, getFilesLayoutOnServer);
}

/** Classic's collections as a tree or as folders and files. */
export function useCollectionsDisplay(): CollectionsDisplay {
  return useSyncExternalStore(subscribeExplorerView, getCollectionsDisplay, getCollectionsDisplayOnServer);
}
