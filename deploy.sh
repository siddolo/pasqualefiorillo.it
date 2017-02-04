#!/bin/bash
PACKAGE_BASE_NAME=pasqualefiorillo.it
DEPLOY_SERVER=pasqualefiorillo.it.deploy
DEPLOY_USER=sysop
DEPLOY_PATH=/home/pasqualefiorillo.it/
SUDO_USER=root
ENFORCE_OWNERSHIP="pasqualefiorillo.it:pasqualefiorillo.it"
ENFORCE_PERMISSION="g-w,o-w"

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ "$#" -eq  "0" ]; then
	RELEASETAG=master
else
	RELEASETAG=$1
fi

RELEASE="$(date +%Y%m%d%H%M)"
DIRECTORY="${PACKAGE_BASE_NAME}-${RELEASE}"
PACKAGE="${PACKAGE_BASE_NAME}-${RELEASE}.tar.bz2"

echo "$(date +'%Y-%m-%d %H:%M:%S') Creating ${PACKAGE} ..."
git archive --format=tar --prefix=${DIRECTORY}/ ${RELEASETAG} | bzip2 -9 > ${PACKAGE}
echo "$(date +'%Y-%m-%d %H:%M:%S') Uploading ${PACKAGE} to ssh://${DEPLOY_USER}@${DEPLOY_SERVER} ..."
cat "${PACKAGE}" | ssh ${DEPLOY_USER}@${DEPLOY_SERVER} "sudo -u ${SUDO_USER} tar xj -C ${DEPLOY_PATH}"
echo "$(date +'%Y-%m-%d %H:%M:%S') Enforce ownership and permission ..."
ssh ${DEPLOY_USER}@${DEPLOY_SERVER} "sudo -u ${SUDO_USER} chown ${ENFORCE_OWNERSHIP} -R ${DEPLOY_PATH}${DIRECTORY}"
ssh ${DEPLOY_USER}@${DEPLOY_SERVER} "sudo -u ${SUDO_USER} chmod ${ENFORCE_PERMISSION} -R ${DEPLOY_PATH}${DIRECTORY}"
echo "$(date +'%Y-%m-%d %H:%M:%S') Linking the document root to the current package  ${DEPLOY_PATH}${DIRECTORY}/http ..."
ssh ${DEPLOY_USER}@${DEPLOY_SERVER} "sudo -u ${SUDO_USER} rm ${DEPLOY_PATH}www"
ssh ${DEPLOY_USER}@${DEPLOY_SERVER} "sudo -u ${SUDO_USER} ln -s ${DEPLOY_PATH}${DIRECTORY}/http ${DEPLOY_PATH}www"

echo "$(date +'%Y-%m-%d %H:%M:%S') Removing ${PACKAGE} ..."
rm "${PACKAGE}"
echo "$(date +'%Y-%m-%d %H:%M:%S') Done"
