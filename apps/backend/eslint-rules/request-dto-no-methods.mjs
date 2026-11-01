export const requestDtoNoMethods = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      method:
        '요청 DTO에는 메서드를 두지 않는다. 변환은 DTO를 받는 서비스가 한다.',
    },
  },
  create(context) {
    return {
      'ClassBody > MethodDefinition'(member) {
        context.report({ node: member.key, messageId: 'method' });
      },
    };
  },
};
