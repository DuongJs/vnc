FROM buildpack-deps:22.04-curl

RUN apt-get update && apt-get install -y --no-install-recommends \
    ansible \
    git \
    unzip \
    xz-utils \
    openssh-client \
    openssl \
    dnsutils \
    curl \
    sudo \
    screen \
    smbclient \
    wget \
    rsync \
    whois \
    netcat \
    nmap \
    terminator \
    tmux \
    vim \
    neofetch \
    wget \
    curl \
    net-tools \
    locales \
    bzip2 \
    python3-numpy \
    supervisor \
    xdotool \
    zsh \
    && rm -rf /var/lib/apt/lists/*
RUN curl -sL https://deb.nodesource.com/setup_20.x | sudo -E bash -\
    && apt install nodejs
WORKDIR /home/

ARG RELEASE_TAG="openvscode-server-v1.82.2"
ARG RELEASE_ORG="gitpod-io"
ARG OPENVSCODE_SERVER_ROOT="/home/.openvscode-server"

# Downloading the latest VSC Server release and extracting the release archive
# Rename `openvscode-server` cli tool to `code` for convenience
RUN if [ -z "${RELEASE_TAG}" ]; then \
        echo "The RELEASE_TAG build arg must be set." >&2 && \
        exit 1; \
    fi && \
    arch=$(uname -m) && \
    if [ "${arch}" = "x86_64" ]; then \
        arch="x64"; \
    elif [ "${arch}" = "aarch64" ]; then \
        arch="arm64"; \
    elif [ "${arch}" = "armv7l" ]; then \
        arch="armhf"; \
    fi && \
    wget https://github.com/${RELEASE_ORG}/openvscode-server/releases/download/${RELEASE_TAG}/${RELEASE_TAG}-linux-${arch}.tar.gz && \
    tar -xzf ${RELEASE_TAG}-linux-${arch}.tar.gz && \
    mv -f ${RELEASE_TAG}-linux-${arch} ${OPENVSCODE_SERVER_ROOT} && \
    cp ${OPENVSCODE_SERVER_ROOT}/bin/remote-cli/openvscode-server ${OPENVSCODE_SERVER_ROOT}/bin/remote-cli/code && \
    rm -f ${RELEASE_TAG}-linux-${arch}.tar.gz

ARG USERNAME=user
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Creating the user and usergroup
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USERNAME -m -s /bin/bash $USERNAME \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

RUN chmod g+rw /home && \
    mkdir -p /home/workspace && \
    chown -R $USERNAME:$USERNAME /home/workspace && \
    chown -R $USERNAME:$USERNAME ${OPENVSCODE_SERVER_ROOT}

USER $USERNAME

WORKDIR /home/workspace/

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/home/workspace \
    EDITOR=code \
    VISUAL=code \
    GIT_EDITOR="code --wait" \
    OPENVSCODE_SERVER_ROOT=${OPENVSCODE_SERVER_ROOT}

# Install Softwares
RUN yes | sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
RUN sudo chsh -s ~/.zshrc

# Install VS Code Extensions
ENV OPENVSCODE="${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server"
RUN ${OPENVSCODE} --install-extension ms-python.python && \
    ${OPENVSCODE} --install-extension monokai.theme-monokai-pro-vscode

RUN sudo mkdir -p /data && sudo chown $USERNAME: /data

EXPOSE 7860

ENTRYPOINT [ "/bin/sh", "-c", "exec ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server --host 0.0.0.0 --port 7860 --without-connection-token"]
