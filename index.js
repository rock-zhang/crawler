const fs = require('fs');
const cheerio = require('cheerio');
const request = require('request');
const URL = require('url');
const { URLSearchParams } = URL;
const Downloader = require('mt-files-downloader');
const downloader = new Downloader();
const log4js = require('log4js');
const genericPool = require("generic-pool");
const redis = require("redis"),
    redisClient = redis.createClient();

redisClient.on("error", function (err) {
    console.log("redisClient Error " + err);
});

log4js.configure({
    appenders: {
        everything: {
            type: 'dateFile', filename: `./logs/download.log`, maxLogSize: 10458760, pattern: '.yyyy-MM-dd', compress: true,
            layout: { type: 'coloured' }
        },
        console: {
            type: 'console',
            layout: { type: 'coloured' }
        },
        done: {
            type: 'dateFile', filename: `./logs/done.log`, maxLogSize: 10458760, pattern: '.yyyy-MM', compress: true,
            layout: { type: 'coloured' }
        },
        downloading: {
            type: 'dateFile', filename: `./logs/downloading.log`, maxLogSize: 10458760, pattern: '.yyyy-MM', compress: true,
            layout: { type: 'coloured' }
        },
        error: {
            type: 'dateFile', filename: `./logs/error.log`, maxLogSize: 10458760, pattern: '.yyyy-MM', compress: true,
            layout: { type: 'coloured' }
        }
    },
    categories: {
        default: { appenders: ['everything', 'console'], level: 'debug' },
        done: { appenders: ['done'], level: 'debug' },
        downloading: { appenders: ['downloading'], level: 'debug' },
        error: { appenders: ['error'], level: 'debug' }
    }
});

const logger = log4js.getLogger();
const downloadErrorLogger = log4js.getLogger('error');
const downloadingLogger = log4js.getLogger('downloading');
const downloadedLogger = log4js.getLogger('done');


const listPageUrl = 'http://91porn.com/video.php?category=rf&page=1',
    videoPageBase = 'http://91porn.com/view_video.php';



let page = 1;

function getPageCount() {
    return page++;
}

const factory = {
    create: function () {
        const listPageUrl = `http://91porn.com/video.php?category=rf&page=${getPageCount()}`;

        return listPageUrl;
    },
    destroy: function (listPageUrl) {
        console.log('destroy', listPageUrl);
    }
};

const downloadPool = genericPool.createPool(factory, {
    max: 4, // maximum size of the pool
    min: 2 // minimum size of the pool
});

const pageCount = 118, videoInfoList = [];
let i = 1;
while (i < pageCount) {
    const resourcePromise = downloadPool.acquire();

    resourcePromise.then(function (listPageUrl) {
        console.log('resourcePromise:', listPageUrl);

        htmlFetch(listPageUrl).then($ => {
            $('#videobox .listchannel').each(async function (i, elem) {
                const url = $(this).find('a').attr('href'),
                    viewkey = new URLSearchParams(URL.parse(url).query).get('viewkey'),
                    videoInfo = await getVideoInfo(videoPageUrlParse(viewkey));

                videoInfoList.push(videoInfo);
                console.log('videoUrl', videoInfo, videoInfoList.length);
            });

            downloadPool.release(listPageUrl);
        });
    }).catch(function (err) {
        console.log('downloadPool resourcePromise catch', err);
    });

    i++;
}

function getRandomIP() {
    const bytes = new Array(4);
    return bytes.map(b => Math.floor(Math.random() * 255));
}

function htmlFetch(url, flag) {
    return new Promise(resolve => {
        const options = {
            url,
            headers: {
                'X-Forwarded-For': getRandomIP()
            }
        };

        request(options, function (error, response, body) {
            if (error)
                logger.error('request error:', error);

            logger.debug(`${url} response:`, response.statusCode);

            resolve(cheerio.load(body));
        });
    });
}

function getVideoInfo(url) {
    return htmlFetch(url, true).then($ => {
        let videoUrl = '';
        const nameReg = /(?<=fxFeatureVideo\(0\, )\d+(?=\)\;)/,
            urlReg = /(?<=source src=\").+(?=\" type)/;

        try {
            videoUrl = urlReg.exec($.html())[0];
            videoUrl = videoUrl.replace('amp;', '');
        } catch (e) {
            downloadErrorLogger.error('getVideoInfo: 正则表达式匹配出错', url, videoUrl);
        }

        return {
            url: videoUrl,
            name: nameReg.exec($.html())[0]
        };
    }).catch(e => {
        logger.error('getVideoInfo:', e);
    });
}

function videoPageUrlParse(viewkey) {
    return `${videoPageBase}?${new URLSearchParams({ viewkey }).toString()}`;
}

function download(url, filename) {
    const mtdPath = './download/' + filename + '.mtd';

    if (fs.existsSync('./download/' + filename)) {
        logger.warn(filename + ' is exsit...');
        return;
    }

    let dl = null;
    if (fs.existsSync(mtdPath)) {
        dl = downloader.resumeDownload(mtdPath);
    } else {
        dl = downloader.download(url, './download/' + filename);
    }

    dl.setRetryOptions({
        maxRetries: 30		// Default: 5
    });

    dl.on('start', (dl) => {
        logger.info('EVENT - Download start ' + url)
        logger.debug(dl.getStats());

        downloadingLogger.info(filename);
    });

    dl.on('error', function () {
        logger.error('EVENT - Download error ! ' + url);
        logger.error(dl.error);

        downloadErrorLogger.error(filename);
        deleteMTDFile(filename);
    });

    dl.on('end', function () {
        logger.debug('EVENT - Download finished ! ' + url);
        logger.debug(dl.getStats());

        downloadedLogger.info(filename);
    });

    dl.on('retry', function (dl) {
        logger.warn('EVENT - Download retry ! ' + url);
        logger.warn(dl.getStats());
    });

    dl.on('destroyed', function (dl) {
        logger.error('EVENT - Download destroyed ! ' + url);
        logger.error(dl.getStats());

        downloadErrorLogger.error(filename);
    });

    dl.on('stopped', function (dl) {
        logger.error('EVENT - Download stopped ! ' + url);
        logger.error(dl.getStats());

        downloadErrorLogger.error(filename);
    });

    printStats(dl, filename);

    dl.start();
}

function deleteMTDFile(filename) {
    const mtd = './download/' + filename + '.mtd';
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


