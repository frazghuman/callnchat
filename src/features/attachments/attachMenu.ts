import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ActionSheetIOS, Alert } from 'react-native';

import { prepareDocument, preparePhoto, prepareVideo, type PreparedAttachment } from './prepare';

type Handlers = {
  send: (prepared: PreparedAttachment) => Promise<void>;
  sendLocation: (liveMinutes: number) => Promise<void>;
};

function fail(title: string, e: unknown) {
  Alert.alert(title, e instanceof Error ? e.message : String(e));
}

async function sendAssets(assets: ImagePicker.ImagePickerAsset[], handlers: Handlers) {
  for (const asset of assets) {
    const prepared =
      asset.type === 'video'
        ? await prepareVideo(asset)
        : await preparePhoto({
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            fileName: asset.fileName,
          });
    await handlers.send(prepared);
  }
}

async function fromCamera(handlers: Handlers) {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync();
  if (!granted) {
    Alert.alert('Camera access needed', 'Allow the camera for CallNChat in iOS Settings.');
    return;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images', 'videos'],
    quality: 1,
  });
  if (!result.canceled) await sendAssets(result.assets, handlers);
}

async function fromLibrary(handlers: Handlers) {
  // The iOS photo picker runs out of process and needs no library permission.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    quality: 1,
    allowsMultipleSelection: true,
    selectionLimit: 10,
  });
  if (!result.canceled) await sendAssets(result.assets, handlers);
}

async function fromDocuments(handlers: Handlers) {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled) return;
  for (const asset of result.assets) {
    await handlers.send(
      await prepareDocument({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType }),
    );
  }
}

function chooseLocation(handlers: Handlers) {
  const minutes = [0, 15, 60, 480];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Share location',
      message: 'Live location updates while CallNChat is open on your phone.',
      options: [
        'Send current location',
        'Share live location for 15 minutes',
        'Share live location for 1 hour',
        'Share live location for 8 hours',
        'Cancel',
      ],
      cancelButtonIndex: 4,
    },
    (index) => {
      const live = minutes[index];
      if (live === undefined) return;
      handlers.sendLocation(live).catch((e: unknown) => fail("Couldn't share location", e));
    },
  );
}

/** The ＋ menu in the composer. */
export function showAttachMenu(handlers: Handlers) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      options: ['Camera', 'Photo & Video Library', 'Document', 'Location', 'Cancel'],
      cancelButtonIndex: 4,
    },
    (index) => {
      const run = [fromCamera, fromLibrary, fromDocuments][index];
      if (run) run(handlers).catch((e: unknown) => fail("Couldn't attach", e));
      else if (index === 3) chooseLocation(handlers);
    },
  );
}
