FROM registry.ci.iog.io/midnight-base-container:latest
ENV WALLET_PORT=5206 WALLET=1 WALLET_HOST=0.0.0.0
COPY ./typescript /source/
EXPOSE ${WALLET_PORT}
ENTRYPOINT [ "/bin/bash", "-c" ]
WORKDIR /source/apps/wallet-server
CMD [ "node --experimental-specifier-resolution=node ./dist/index.js start --wallet=${WALLET} --port=${WALLET_PORT} --cli=false" ]
