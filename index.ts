import { scanForMp3 } from './src/scanner/fileScanner.js';
import { readTag } from './src/metadata/id3Reader.js';
import { writeCover, writeTags } from './src/metadata/id3Writer.js';
import { resolveCover } from './src/cover/resolver.js';
import { log } from './src/utils/logger.js';
import { parseFilename } from './src/utils/filenameParser.js';
import { searchRecording } from './src/cover/musicbrainz.js';
import fs from 'fs';

import PQueue from 'p-queue';

async function run() {
  const target = process.argv[2] || './music';

  log.info(`Scanning: ${target}`);
  const files = await scanForMp3(target);
  log.info(`Found ${files.length} MP3 files`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    log.info(`(${i + 1}/${files.length}) Processing: ${file}`);
    let tag = readTag(file);

    if (!tag.artist || !tag.album) {
      log.info('Missing metadata, attempting to fetch from filename');
      const parsed = parseFilename(file);
      if (parsed.title) {
        log.info(
          `Searching MusicBrainz for: ${parsed.artist ? parsed.artist + ' - ' : ''}${parsed.title}`
        );
        let webMetadata = await searchRecording(parsed.artist, parsed.title);

        if (!webMetadata) {
          log.info('MusicBrainz search failed, trying iTunes fallback...');
          const { searchiTunesMetadata } = await import('./src/cover/itunes.js');
          webMetadata = await searchiTunesMetadata(parsed.artist, parsed.title);
        }

        if (webMetadata) {
          log.success(
            `Found metadata: ${webMetadata.artist} - ${webMetadata.title} (${webMetadata.album})`
          );
          writeTags(file, {
            artist: webMetadata.artist,
            album: webMetadata.album || undefined,
            title: webMetadata.title,
          });
          // Re-read tags after writing
          tag = readTag(file);
        } else {
          log.warn('Could not find metadata on MusicBrainz');
        }
      } else {
        log.warn('Could not parse title from filename');
      }
    }

    if (!tag.artist || !tag.album) {
      log.warn('Still missing metadata, skipping cover search');
      continue;
    }

    if (tag.image) {
      log.info('Cover already exists');
      continue;
    }

    const coverPath = await resolveCover(tag.artist, tag.album);
    if (!coverPath) {
      log.warn('No cover found');
      continue;
    }

    const img = fs.readFileSync(coverPath);
    writeCover(file, img);

    log.success('Cover embedded');
  }
}

run().catch((err) => log.error(String(err)));
