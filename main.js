var express = require('express');
var iconv = require('iconv-lite'); //字符集转换
var mongo = require('mongodb');
var monk = require('monk');
var Request = require('request');
var RsaEncrypt = require("./rsa").RSAKey;
var async = require('async');
var cheerio = require('cheerio');
var cookieColl = Request.jar();
var url = require('url');

var app = express();
var request = Request.defaults({
    jar: cookieColl
});

var fs = require("fs");

var connection_string = '127.0.0.1:27017/weiboSina3';
var db = monk(connection_string);
var cachedUsers = {};

var userCnt = 0;
var showDetail = [];

var baseUrl = 'http://weibo.com/';
var userName = "";
var password = "";



app.get('/', function(req, res, next) {
    function saveUser(user) {
        // var userColl = db.get("users");
        //  userColl.insert(user);
        fs.writeFile("results", user, function(err) {
            if (err) throw err;
            console.log('saver'); //文件被保存
        });
    }


    function tryParseInt(str) {
        try {
            return parseInt(str);
        } catch (e) {
            console.log("parseInt failed.")
            return 0;
        }
    }


    function start(userName, password) {
        var preLoginUrl = "http://login.sina.com.cn/sso/prelogin.php?entry=weibo&callback=sinaSSOController.preloginCallBack&su=&rsakt=mod&checkpin=1&client=ssologin.js(v1.4.11)&_=" + (new Date()).getTime();
        async.waterfall([
            function(callback) {
                // fs.writeFile("result.txt", preLoginUrl, function(err) {
                //     if (err) throw err;
                //     console.log("File Saved !"); //文件被保存
                // });
                request({
                    "uri": preLoginUrl,
                    "encoding": "utf-8"
                }, callback);
            },

            function(responseCode, body, callback) {
                var responseJson = getJsonObj(body);
                var loginUrl = 'http://login.sina.com.cn/sso/login.php?client=ssologin.js(v1.4.18)';
                var loginPostData = {
                    entry: "weibo",
                    gateway: "1",
                    from: "",
                    savestate: "7",
                    useticket: "1",
                    vsnf: "1",
                    su: "",
                    service: "miniblog",
                    servertime: "",
                    nonce: "",
                    pwencode: "rsa2",
                    rsakv: "1330428213",
                    sp: "",
                    sr: "1920*1080",
                    encoding: "UTF-8",
                    prelt: "282",
                    url: "http://weibo.com/ajaxlogin.php?framelogin=1&callback=parent.sinaSSOController.feedBackUrlCallBack",
                    returntype: "META"
                };

                //username 进行base的加密
                loginPostData.su = new Buffer(userName).toString('base64');

                //password 经过了三次的SHA1加密，两次加密后加入了servertime和nonce再进行一次加密
                var rsaKey = new RsaEncrypt();
                rsaKey.setPublic(responseJson.pubkey, '10001');
                var pwd = rsaKey.encrypt([responseJson.servertime, responseJson.nonce].join("\t") + "\n" + password);
                loginPostData.sp = pwd;

                loginPostData.servertime = responseJson.servertime;
                loginPostData.nonce = responseJson.nonce;
                loginPostData.rsakv = responseJson.rsakv;

                request.post({
                    "uri": loginUrl,
                    "encoding": null, //GBK编码 需要额外收到处理,
                    form: loginPostData
                }, callback);
            },

            function(responseCode, body, callback) {
                body = iconv.decode(body, "GBK");

                var errReason = /reason=(.*?)\"/;
                var errorLogin = body.match(errReason);

                if (errorLogin) {
                    callback("登录失败,原因:" + errorLogin[1]);
                } else {
                    var urlReg = /location\.replace\(\'(.*?)\'\)./;
                    var urlLoginAgain = body.match(urlReg);
                    if (urlLoginAgain) {
                        request({
                            "uri": urlLoginAgain[1],
                            "encoding": "utf-8"
                        }, callback);
                    } else {
                        callback("match failed");
                    }
                }
            },
            function(responseCode, body, callback) {
                console.log("登录完成");
                var responseJson = getJsonObj(body);


                var myfansUrl = "http://weibo.com/" + responseJson.userinfo.uniqueid + "/myfans"

                request({
                    "uri": myfansUrl,
                    "encoding": "utf-8"
                }, callback);

                var fansUrl = "http://weibo.com/{userId}/fans";
            },
            function(responseCode, body, callback) {
                console.log("开始分析... ");

                var myFans = getFriends(body);
                callback(null, myFans);
                // console.log("Myfans:" + myFans.length);
                // myFans.map(function(item) {
                //     getFansRecur(item.uId);
                // });
            },
            function(fansList, callback) {
                var profile = async.mapLimit(fansList, 5, function(item, callback) {
                    request({
                        "uri": item['href'],
                        "encoding": "utf-8"
                    }, function(err, response, body) {
                        if (err) {
                            console.log(err);
                        } else {
                            var userInfo=getUserInfo(body,item['username']);

                            callback(null, userInfo);
                        }
                    });

                }, function(err, results) {
                    res.send(results)
                    fs.writeFile("results2.txt",results, function(err) {
                        if (err) throw err;
                        console.log('saver'); //文件被保存
                    });
                });

                // callback(null, results);

            }

        ], function(err) {
            console.log(err)
        });
    }

    start(userName, password);


    //功能函数
    function getFriends(reshtml) {

        var matched = reshtml.match(/\"follow_list\s*\\\".*\/ul>/gm);

        if (matched) {
            var strHtml = matched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");

            var $ = cheerio.load(strHtml);
            var fansUrl = []
            $('.follow_item').each(function(idx, element) {
                var $element = $(element)
                var $profile = $element.find('.info_name>a');
                var username = $profile.attr('alt');
                var href = url.resolve(baseUrl, $profile.attr('href'));
                var friends={
                    username:username,
                    href:href
                }
                fansUrl.push(friends);
            });

            return fansUrl;
        }


    }

    function getUserInfo(body,username) {
        var matched = body.match(/\"PCD_person_info\s*\\\".*\/div>/gm);

        if (matched) {
            var inf=[];
            inf.push(username)
            var html = matched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");
            var strHtml = "<div class=" + html;
            // var strHtml = iconv.decode(strHtml, 'gb2312')
            var $ = cheerio.load(strHtml, {decodeEntities: false})
            var details = $('.ul_detail .item_text');
            // details=iconv.decode(details, "GBK")
            
            details.map(function(index, elem) {
                inf.push($(details[index]).text());
            })

        
            return inf;
            // var location = details[0].find('.item_text').text();
            // var school = details[1].find('.item_text').text();
            // var love = details[2].find('.item_text').text();
            // var birthday = details[3].find('.item_text').text();
            // var introduction = details[4].find('.item_text').text();

            // return {
            //     // name: name,
            //     // sex: sex,
            //     location: location
            //     // school: school,
            //     // love: love,
            //     // birthday: birthday,
            //     // introduction: introduction
            // };
        }
    }


    //get JSON格式
    function getJsonObj(body) {
        var start = body.indexOf("{");
        var end = body.lastIndexOf("}");
        var jsonStr = body.substr(start, end - start + 1);
        var responseJson = JSON.parse(jsonStr);
        return responseJson;
    }

})


app.listen(3000, function() {
    console.log('app is listening at port 3000');
});
