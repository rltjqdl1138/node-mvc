exports.tags = ['계정 정보'];
exports.summary = '내 계정 정보 불러오기';

exports.request = {
    path: '/sample',
    method: 'get',
};

exports.security = ['USER'];
exports.description = ``
exports.params = {
  path: {},
  query: {}
};

exports.execute = async ({user}) => {
   return
};

exports.response = {
    '200':{ description:'Success' },
    '400':{ description:'Parameter Error' },
}