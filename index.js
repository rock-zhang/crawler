const fs = require('fs');
const URL = require('url');
const { URLSearchParams } = URL;
const Downloader = require('mt-files-downloader');
const downloader = new Downloader();
const genericPool = require("generic-pool");
const {
    redisClient,
    logger, downloadedLogger,
    getRandomIP,
    htmlFetch
} = require('./util');
const config = require('./config.json');

let page = 1;
function getPageCount() {
    return page++;
}

const factory = {
    create: function () {
        return 'client...';
    },
    destroy: function (listPageUrl) {
        console.log('destroy', listPageUrl);
    }
};

const downloadPool = genericPool.createPool(factory, {
    max: 10, // maximum size of the pool
    min: 2 // minimum size of the pool
});

redisClient.keysAsync('*').then(keys => {
    console.log(keys)
    const len = keys.length;

    keys.forEach(viewkey => {
        downloadPool.acquire().then(function (client) {
            redisClient.hgetallAsync(viewkey).then(async videoInfo => {
                console.log('videoInfo:', videoInfo)
                download(videoInfo.url, videoInfo.name, () => {
                    downloadPool.release(client);
                });
            });
        });
    });
})


function videoPageUrlParse(viewkey) {
    return `${videoPageBase}?${new URLSearchParams({ viewkey }).toString()}`;
}

function download(url, filename, callback) {
    const mtdPath = config.downloadPath + filename + '.mtd';

    if (fs.existsSync(config.downloadPath + filename)) {
        logger.warn(config.downloadPath + filename + ' is exsit...');
        callback();
        return;
    }

    let dl = null;
    if (fs.existsSync(mtdPath)) {
        dl = downloader.resumeDownload(mtdPath);
    } else {
        dl = downloader.download(url, config.downloadPath + filename);
    }

    dl.setRetryOptions({
        maxRetries: 20		// Default: 5
    });

    dl.on('start', (dl) => {
        logger.info('EVENT - Download start ' + url)
        logger.debug(dl.getStats());

        logger.info(filename);
    });

    dl.on('error', function () {
        logger.error('EVENT - Download error ! ' + url);
        logger.error(dl.error);

        logger.error(filename);
        deleteMTDFile(filename);
        callback();
    });

    dl.on('end', function () {
        logger.debug('EVENT - Download finished ! ' + url);
        logger.debug(dl.getStats());

        downloadedLogger.info(filename);
        callback();
    });

    dl.on('retry', function (dl) {
        logger.warn('EVENT - Download retry ! ' + url);
        logger.warn(dl.getStats());
    });

    dl.on('destroyed', function (dl) {
        logger.error('EVENT - Download destroyed ! ' + url);
        logger.error(dl.getStats());

        logger.error(filename);
        callback();
    });

    dl.on('stopped', function (dl) {
        logger.error('EVENT - Download stopped ! ' + url);
        logger.error(dl.getStats());

        logger.error(filename);
        callback();
    });

    printStats(dl, filename);

    dl.start();
}

function deleteMTDFile(filename) {
    const mtd = config.downloadPath + filename + '.mtd';
    fs.unlink(mtd, () => logger.debug(mtd + ' deleted..'));
}

function printStats(dl, filename) {
    let timer = setInterval(function () {
        if (dl.status == 0) {
            logger.debug('Download ' + filename + ' not started.');
        } else if (dl.status == 1) {
            const stats = dl.getStats();
            logger.info('Download ' + filename + ' is downloading:');
            logger.info('Download progress: ' + stats.total.completed + ' %');
            logger.info('Download speed: ' + Downloader.Formatters.speed(stats.present.speed));
            logger.info('Download time: ' + Downloader.Formatters.elapsedTime(stats.present.time));
            logger.info('Download ETA: ' + Downloader.Formatters.remainingTime(stats.future.eta));
        } else if (dl.status == 2) {
            logger.warn('Download ' + filename + ' error... retrying');
        } else if (dl.status == 3) {
            logger.debug('Download ' + filename + ' completed !');
        } else if (dl.status == -1) {
            logger.error('Download ' + filename + ' error : ' + dl.error);
        } else if (dl.status == -2) {
            logger.error('Download ' + filename + ' stopped.');
        } else if (dl.status == -3) {
            logger.error('Download ' + filename + ' destroyed.');
        }

        logger.debug('------------------------------------------------');

        if (dl.status === -1 || dl.status === 3 || dl.status === -3) {
            clearInterval(timer);
            timer = null;
        }
    }, 10000)
}


