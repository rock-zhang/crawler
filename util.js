const log4js = require('log4js');
const bluebird = require('bluebird');
const redis = require("redis");
const cheerio = require('cheerio');
const request = require('request');

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);
const redisClient = redis.createClient();

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
        }
    },
    categories: {
        default: { appenders: ['everything', 'console'], level: 'debug' },
        done: { appenders: ['done'], level: 'debug' }
    }
});

const logger = log4js.getLogger();
const downloadedLogger = log4js.getLogger('done');

function getRandomIP() {
    const bytes = [1, 2, 3, 4];
    return bytes.map(b => Math.floor(Math.random() * 255)).join('.');
}

function htmlFetch(url, flag) {
    return new Promise((resolve, reject) => {
        const options = {
            url,
            headers: {
                'X-Forwarded-For': getRandomIP(),
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,es;q=0.7,zh-TW;q=0.6,fi;q=0.5,ko;q=0.4'
            }
        };

        request(options, function (error, response, body) {
            if (error || response.statusCode !== 200) {
                logger.error('request error:', error, response && response.statusCode);
                reject(error);

                return;
            }

            logger.debug(`${url} response:`, response.statusCode);

            resolve(cheerio.load(body));
        });
    });
}


module.exports = {
    logger,
    downloadedLogger,

    getRandomIP,
    htmlFetch,

    redisClient
}
