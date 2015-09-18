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
var superagent = require('superagent');

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




    function getFansRecur(userId) {

        //新浪限制只能取每人前十页的fans
        for (var i = 1; i < 10; i++) {
            var fansUrl = "http://weibo.com/" + userId + "/follow?page=" + i;

            request({
                "uri": fansUrl,
                "encoding": "utf-8"
            }, function(err, response, body) {
                if (err) {
                    console.log(err);
                } else {
                    var userLst = getUserLst(body, userId);
                    console.log(userLst)
                        // if (userLst) {
                        //     userLst.map(function(item) {
                        //         getFansRecur(item.uId);
                        //     });
                        // }
                }
            });

        }
    }

    function getUserLst(htmlContent, userId) {
        var matched = htmlContent.match(/\"follow_list\s*\\\".*\/ul>/gm);

        if (matched) {
            var str = matched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");
            var ulStr = "<ul class=" + str;

            var $ = cheerio.load(ulStr);

            var myFans = [];
            $("li[action-data]").map(function(index, item) {
                var userInfo = getUserInfo($, this);

                if (userInfo) {
                    if (!cachedUsers[userInfo.uId]) {
                        userInfo.from = userId; //设置来源用户
                        cachedUsers[userInfo.uId] = true;

                        // if(userInfo.fansCnt > 100){

                        userCnt++;
                        console.log(userCnt);
                        saveUser(userInfo);
                        myFans.push(userInfo);

                    } else {
                        console.log("duplicate users");
                    }
                }
            });

            return myFans;
        }

        return null;
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


                // var userColl = db.get("users");
                // var lastUid = "";
                // console.log("查询已经记录的用户");
                // var nIndex = 0;

                // userColl.find({}, {
                //     stream: true
                // }).each(function(doc) {
                //     cachedUsers[doc.uId] = true;
                //     lastUid = doc.uId;
                // }).success(function() {
                //     console.log("已有用户已经缓存完成, 开始进行递归查询");
                //     console.log(lastUid);
                //     getFansRecur("3423485724"); //周鸿祎
                // }).error(function(err) {
                //     console.log(err);
                // });


                var myFans = getFriendUrl(body);
                callback(null, myFans);
                // console.log("Myfans:" + myFans.length);
                // myFans.map(function(item) {
                //     getFansRecur(item.uId);
                // });
            },
            function(fansUrl, callbackb) {

                fs.writeFile('tarTxt', strHtml, function(err) {
                    if (err) throw err;
                    console.log('saved')
                });
                res.send(fansUrl)
                    // var profile = async.mapLimit(fansUrl, 5, function(itemUrl, callback) {
                    //     superagent.get(itemUrl)
                    //         .end(function(err, sres) {
                    //             var $ = cheerio.load(sres.text);
                    //             var username = $('.username').text();
                    //             var title = $('.pf_intro').text();
                    //             var sProfile = {
                    //                 usrname: usrname,
                    //                 title: title
                    //             };
                    //             callback(null, sProfile);
                    //         });
                    // }, function(err, results) {
                    //     res.send(results);
                    //     // console.log(results)
                    // });

            }
        ], function(err) {
            console.log(err)
        });
    }

    start(userName, password);


    //功能函数
    function getFriendUrl(reshtml) {

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

                fansUrl.push(href);
            });

            return fansUrl;
        }


    }

    function getUserInfo($, liSelector) {
        res.send($)


        return {
            name: alnk.text(),
            uId: alnk.attr("usercard").split('=')[1],
            followCnt: tryParseInt($(cntSel[0]).text()),
            fansCnt: tryParseInt($(cntSel[1]).text()),
            weiboCnt: tryParseInt($(cntSel[2]).text()),
            addr: addr,
            sex: sex,
            info: personInfo
        };
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
